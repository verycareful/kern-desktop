// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
// Design 4.1: the file manager, left two thirds. Its strip (Places, Volumes,
// Trash) and folder area are filled by Tasks 21 and 22; these are their
// stable boundaries. The folder area shows the active folder tab (Task 21).
import { FolderView } from "../files/FolderView";
import { activeTab, recentFolderTab, useTabs } from "../store/tabs";

export function PlacesPanel(props: { overlay?: boolean }) {
  const active = useTabs((s) => activeTab(s));
  // Slid in over a document, the panel shows the folder tab used last (design 4.3).
  const recent = useTabs((s) => recentFolderTab(s));
  const tab = active?.kind === "folder" ? active : recent;
  return (
    <section
      className={
        props.overlay ? "kern-panel kern-panel-left kern-overlay" : "kern-panel kern-panel-left"
      }
      aria-label="File manager"
      data-testid="places-panel"
    >
      <nav className="kern-places" aria-label="Places" data-testid="places-strip" />
      <div className="kern-folder-area" data-testid="folder-area">
        {tab && <FolderView key={tab.id} tab={tab} />}
      </div>
    </section>
  );
}
