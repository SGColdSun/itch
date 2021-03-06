import suite from "../test-suite";

import { join } from "path";
import * as paths from "./paths";
import { app } from "electron";

import preferencesReducer from "../reducers/preferences";

import { IUpload } from "../types";

suite(__filename, s => {
  s.case("downloadPath", t => {
    const preferences = preferencesReducer(undefined, { type: "BOOT" });
    const userData = app.getPath("userData");

    t.same(
      paths.downloadPath(
        ({
          filename: "voices.tar.gz",
          id: 1990,
        } as any) as IUpload,
        preferences
      ),
      join(userData, "downloads", "1990.tar.gz")
    );
    t.same(
      paths.downloadPath(
        ({
          filename: "FACES OF WRATH.TAR.BZ2",
          id: 1997,
        } as any) as IUpload,
        preferences
      ),
      join(userData, "downloads", "1997.tar.bz2")
    );
    t.same(
      paths.downloadPath(
        ({
          filename: "2019.07.21.zip",
          id: 1990,
        } as any) as IUpload,
        preferences
      ),
      join(userData, "downloads", "1990.zip")
    );
    t.same(
      paths.downloadPath(
        ({
          filename: "the-elusive-extless-file",
          id: 1994,
        } as any) as IUpload,
        preferences
      ),
      join(userData, "downloads", "1994")
    );
  });
});
