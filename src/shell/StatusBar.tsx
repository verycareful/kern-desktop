// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath } from "../ipc";
import { useFolderStatus } from "../files/folder-status";
import { formatSize } from "../files/format";
import { useOps } from "../ops/useOps";
import { activeTab, useTabs } from "../store/tabs";

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Design 4.1: along the bottom, the whole window wide. Item count and
// selection size come from the folder view of the tab (folder-status.ts);
// a document's saved state is shown once the editor has loaded content, so
// only a dirty document is flagged here. The last file operation that ended
// with nothing to report leaves a short message here (ops/useOps.ts).
export function StatusBar() {
  const tab = useTabs((s) => activeTab(s));
  const counts = useFolderStatus((s) =>
    tab?.kind === "folder" || tab?.kind === "trash" ? s.byTab[tab.id] : undefined
  );
  const notice = useOps((s) => s.notice);
  const place = !tab ? "" : tab.kind === "trash" ? "Trash" : displayPath(tab.path);
  return (
    <footer className="kern-status" data-testid="status-bar">
      <span className="kern-status-path" title={place || undefined}>
        {place}
      </span>
      {counts && (
        <span data-testid="status-count">
          {plural(counts.items, "item", "items")}
          {counts.selected > 0 &&
            tab?.kind === "trash" &&
            ` \u00b7 ${counts.selected.toLocaleString("en-US")} selected`}
          {counts.selected > 0 &&
            tab?.kind !== "trash" &&
            ` \u00b7 ${plural(counts.selected, "selected", "selected")} \u00b7 ${formatSize(counts.selectedBytes)}` +
              (counts.selectedFolders > 0
                ? ` (${plural(counts.selectedFolders, "folder", "folders")} not counted)`
                : "")}
        </span>
      )}
      {tab?.kind === "doc" && tab.dirty && <span data-testid="status-dirty">Unsaved changes</span>}
      {notice && (
        <span role="status" data-testid="status-notice">
          {notice.text}
        </span>
      )}
    </footer>
  );
}
