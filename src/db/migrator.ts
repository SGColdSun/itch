import * as squel from "squel";

import { DB } from ".";
import Querier from "./querier";
import { Model, Column } from "./model";
import { Logger } from "../logger";
import { toDateTimeField } from "./datetime-field";

import { sortBy, indexBy, pluck, filter } from "underscore";

export interface IMigrator {
  db: DB;
  logger: Logger;
}

interface IMigration {
  (m: IMigrator): Promise<void>;
}

export interface IMigrations {
  [key: number]: IMigration;
}

const migrationsTable = "__itch_migrations";
export async function runMigrations(
  q: Querier,
  migrations: IMigrations,
  logger: Logger
) {
  ensureMigrationsTable(q);
  const pending = pendingMigrations(q, migrations);

  if (pending.length === 0) {
    return;
  }

  const migrator: IMigrator = {
    db: q.getDB(),
    logger,
  };

  for (const id of pending) {
    try {
      const migration = migrations[id];
      await migration(migrator);
      markMigrated(q, id);
    } catch (e) {
      logger.error(`migration ${id} failed: ${e.stack}`);
    }
  }
}

function ensureMigrationsTable(q: Querier) {
  q.runSql({
    text: `
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      id INTEGER PRIMARY KEY,
      migratedAt DATETIME
    )
    `,
    values: [],
  });
}

function pendingMigrations(q: Querier, migrations: IMigrations): string[] {
  const doneMigrations = q.allSql(
    squel.select().from(migrationsTable).toParam()
  );
  const doneById = indexBy(doneMigrations, "id");

  // all migration ids
  let ids = Object.keys(migrations);
  // sorted by ids (which are timestamps)
  ids = sortBy(ids, x => x);

  const todo = [];
  for (const id of ids) {
    if (!doneById[id]) {
      todo.push(id);
    }
  }

  return todo;
}

function markMigrated(q: Querier, id: string) {
  q.runSql(
    squel
      .insert()
      .into(migrationsTable)
      .setFields({
        id,
        migratedAt: toDateTimeField(new Date()),
      })
      .toParam()
  );
}

export function markAllMigrated(q: Querier, migrations: IMigrations) {
  ensureMigrationsTable(q);
  q.withTransaction(() => {
    for (const id of pendingMigrations(q, migrations)) {
      markMigrated(q, id);
    }
  });
}

interface IModelMap {
  [key: string]: Model;
}

interface ICheckSchemaResult {
  toCreate: {
    model: Model;
  }[];
  toSync: {
    model: Model;
    existingColumns: string[];
  }[];
}

export function hasSchemaErrors(res: ICheckSchemaResult) {
  if (res.toCreate.length > 0) {
    return true;
  }
  if (res.toSync.length > 0) {
    return true;
  }
  return false;
}

/**
 * Check that the DB schema matches our expectations.
 * If tables or columns are missing
 */
export function checkSchema(
  q: Querier,
  modelMap: IModelMap
): ICheckSchemaResult {
  const result: ICheckSchemaResult = {
    toCreate: [],
    toSync: [],
  };

  for (const table of Object.keys(modelMap)) {
    const model = modelMap[table];
    if (table !== model.table) {
      throw new Error(
        `Internal inconsistency: modelMap key is ${table}, model table is ${model.table}`
      );
    }

    const exists = q
      .getDB()
      .prepare(`SELECT name FROM sqlite_master WHERE type="table" AND name=?`)
      .get(model.table);
    if (!exists) {
      result.toCreate.push({ model: model });
      continue;
    }

    const dbColumns = q
      .getDB()
      .prepare(`PRAGMA table_info(${model.table})`)
      .all();
    const byName = indexBy(dbColumns, "name");

    let hadIncorrectColumns = false;

    const { columns } = model;
    for (const column of Object.keys(columns)) {
      const columnType = columns[column];
      const dbColumn = byName[column];
      if (!dbColumn) {
        hadIncorrectColumns = true;
        continue;
      }

      const dbType = dbColumn.type.toLowerCase();
      const assertType = (actual: string, expected: string) => {
        if (expected !== actual) {
          hadIncorrectColumns = true;
        }
      };

      assertType(dbType, sqliteColumnType(columnType));
    }

    if (hadIncorrectColumns) {
      // we don't care about columns that disappeared
      const existingColumns = filter(pluck(dbColumns, "name"), columnName =>
        model.columns.hasOwnProperty(columnName)
      );
      result.toSync.push({ model, existingColumns });
    }
  }

  return result;
}

export function fixSchema(q: Querier, checkResult: ICheckSchemaResult) {
  for (const createItem of checkResult.toCreate) {
    const { model } = createItem;
    createTableForModel(q, model);
  }

  for (const syncItem of checkResult.toSync) {
    const { model, existingColumns } = syncItem;
    const conn = q.getDB().getConnection();
    q.withTransaction(() => {
      const tempName = "__itch_migrator_temp";

      conn.prepare("pragma foreign_keys = 0").run();
      conn
        .prepare(`create table ${tempName} as select * from ${model.table}`)
        .run();
      conn.prepare(`drop table ${model.table}`).run();

      createTableForModel(q, model);

      conn
        .prepare(
          `insert into ${model.table} (${existingColumns.join(
            ", "
          )}) select ${existingColumns.join(", ")} from ${tempName}`
        )
        .run();

      conn.prepare(`drop table ${tempName}`).run();

      conn.prepare("pragma foreign_keys = 1").run();
    });
  }
}

function createTableForModel(q: Querier, model: Model) {
  q.runSql({
    text: `
    CREATE TABLE ${model.table} (
    ${Object.keys(model.columns)
      .map(columnName => {
        const columnType = model.columns[columnName];
        const primary = columnName === model.primaryKey ? " PRIMARY KEY" : "";
        return `${columnName} ${sqliteColumnType(columnType)}${primary}`;
      })
      .join(",")}
    )
    `,
    values: [],
  });
}

function sqliteColumnType(columnType: Column): string {
  switch (columnType) {
    case Column.Boolean:
      return "boolean";
    case Column.Integer:
      return "integer";
    case Column.JSON:
      return "text";
    case Column.Text:
      return "text";
    case Column.DateTime:
      return "timestamp without time zone";
    default:
      // we don't know how to check other types
      throw new Error(`Unsupported column type ${columnType}`);
  }
}
