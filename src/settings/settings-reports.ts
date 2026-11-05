// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import type { CorruptReport } from "../ipc";
import { useOps } from "../ops/useOps";
import { corruptText, useStoreErrors } from "../store/store-errors";
import { SETTINGS_FILE } from "./settings-draft";

/** The store file the window's layout is kept in (store.rs). */
export const LAYOUT_FILE = "layout.json";

/**
 * Says in the status bar when settings.json or layout.json could not be read. Kern then runs
 * on defaults, which the user would otherwise only find out about in the
 * Settings window. The reports are followed by Pinned and Recent for the whole
 * life of the main window (MainWindow.tsx), so this only reads them.
 */
export function useSettingsReportNotice(): void {
  useEffect(() => {
    let seen = 0;
    const say = (reports: CorruptReport[]) => {
      const fresh = reports
        .slice(seen)
        .filter((r) => r.file === SETTINGS_FILE || r.file === LAYOUT_FILE);
      seen = reports.length;
      for (const r of fresh) useOps.getState().notify(corruptText(r));
    };
    say(useStoreErrors.getState().reports);
    return useStoreErrors.subscribe((s) => say(s.reports));
  }, []);
}
