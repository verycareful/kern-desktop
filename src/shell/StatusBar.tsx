// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath } from "../ipc";
import { encodingText, endingText, useDocStatus } from "../editor/doc-status";
import { useFolderStatus } from "../files/folder-status";
import { formatSize } from "../files/format";
import { noticesShown, useOps } from "../ops/useOps";
import { activeTab, useTabs, isPlaceTab, tabTitle } from "../store/tabs";

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Along the bottom, the whole window wide. Item count and
// selection size come from the folder view of the tab (folder-status.ts);
// a document shows its cursor position, encoding and line ending (editor/
// doc-status.ts) and a dot while it has unsaved changes. The last file operation that ended
// with nothing to report leaves a short message here (ops/useOps.ts).
export function StatusBar() {
  const tab = useTabs((s) => activeTab(s));
  const counts = useFolderStatus((s) =>
    tab?.kind === "folder" || tab?.kind === "trash" ? s.byTab[tab.id] : undefined
  );
  const docStatus = useDocStatus((s) => (tab?.kind === "doc" ? s.byTab[tab.id] : undefined));
  const notice = useOps((s) => s.notice);
  const earlier = useOps((s) => s.earlier);
  const place = !tab ? "" : isPlaceTab(tab) ? tabTitle(tab) : displayPath(tab.path);
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
      {tab?.kind === "doc" && docStatus && (
        <span className="kern-status-doc" data-testid="status-doc">
          <span data-testid="status-position">{`Ln ${docStatus.line}, Col ${docStatus.col}`}</span>
          <span data-testid="status-encoding">{encodingText(docStatus.bom)}</span>
          <span data-testid="status-ending">{endingText(docStatus.ending)}</span>
        </span>
      )}
      {tab?.kind === "doc" && tab.dirty && (
        <span
          className="kern-dirty"
          role="img"
          aria-label="Unsaved changes"
          title="Unsaved changes"
          data-testid="status-dirty"
        />
      )}
      {notice && (
        <span role="status" data-testid="status-notice">
          {noticesShown({ notice, earlier }).map((n, i) => (
            <span key={n.id} className={n.again ? "kern-notice-again" : undefined}>
              {i > 0 && " "}
              {n.text}
            </span>
          ))}
        </span>
      )}
    </footer>
  );
}
