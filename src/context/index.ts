import { DB } from "../db";
import { IStore, IProgressInfo, IProgressListener, Cancelled } from "../types";

import { EventEmitter } from "events";

interface IStopper {
  (): Promise<void>;
}

interface IAbortListener {
  (): void;
}

type Work<T> = () => Promise<T>;

interface IWithStopperOpts<T> {
  stop: IStopper;
  work: Work<T>;
}

const cancelPoisonValue = {};

export default class Context {
  private emitter: EventEmitter = new EventEmitter();
  private stoppers: IStopper[] = [];
  private dead = false;
  private cancelPromise: Promise<{}>;
  private resolveCancelPromise: () => void = null;
  private taskId: string = null;

  constructor(public store: IStore, public db: DB) {
    this.cancelPromise = new Promise((resolve, reject) => {
      this.resolveCancelPromise = resolve;
    });
  }

  /**
   * Try to abort this whole context. If it can't, it'll throw.
   */
  async tryAbort() {
    if (this.dead) {
      return;
    }

    this.dead = true;

    while (this.stoppers.length > 0) {
      const stopper = this.stoppers.pop();
      try {
        await stopper();
      } catch (e) {
        this.dead = false;
        throw e;
      }
    }

    this.resolveCancelPromise();
    this.emitter.emit("abort");
  }

  /**
   * Do some work that can be cancelled (launching a progress,
   * downloading something, etc.)
   */
  async withStopper<T>(opts: IWithStopperOpts<T>): Promise<T> {
    if (this.dead) {
      throw new Cancelled();
    }

    this.stoppers.push(opts.stop);
    try {
      const result = await Promise.race([opts.work(), this.cancelPromise]);
      if (this.dead || result === cancelPoisonValue) {
        throw new Cancelled();
      }
      return result as T;
    } catch (e) {
      throw e;
    } finally {
      this.stoppers = this.stoppers.filter(c => c !== opts.stop);
    }
  }

  registerTaskId(taskId: string) {
    this.taskId = taskId;
  }

  getTaskId(): string {
    return this.taskId;
  }

  async withSub<T>(f: (sub: Context) => Promise<T>): Promise<T> {
    const sub = new Context(this.store, this.db);
    if (this.taskId) {
      sub.registerTaskId(this.taskId);
    }
    return await this.withStopper({
      stop: async () => {
        await sub.tryAbort();
      },
      work: async () => {
        return await f(sub);
      },
    });
  }

  on(ev: "abort", listener: IAbortListener);
  on(ev: "progress", listener: IProgressListener);

  on(ev: string, listener: (data: any) => void) {
    this.emitter.on(ev, listener);
  }

  emitProgress(progress: IProgressInfo) {
    this.emitter.emit("progress", progress);
  }

  isDead(): boolean {
    return this.dead;
  }
}
