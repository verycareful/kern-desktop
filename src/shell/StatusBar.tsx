// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath } from "../ipc";
import { activeTab, useTabs } from "../store/tabs";

// Design 4.1: along the bottom. Item count and selection size for a folder tab
// are added with the folder area (Task 21).
export function StatusBar() {
  const tab = useTabs((s) => activeTab(s));
  return (
    <footer className="kern-status" data-testid="status-bar">
      <span className="kern-status-path" title={tab ? displayPath(tab.path) : undefined}>
        {tab ? displayPath(tab.path) : ""}
      </span>
      {tab?.kind === "doc" && (
        <span data-testid="status-dirty">{tab.dirty ? "Unsaved changes" : "Saved"}</span>
      )}
    </footer>
  );
}
