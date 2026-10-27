// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
// Design 4.1: the file manager. Docked, its two parts are cells of the
// main grid: the places strip from the window top to the status bar, and the
// folder area beside it under the tab row. Slid in over a document (4.3) they
// are one panel. The strip (Places, Volumes, Trash) is filled by a later task;
// its top slot, level with the tab row, is free and left empty.
import { FolderView } from "../files/FolderView";
import { activeTab, recentFolderTab, useTabs } from "../store/tabs";

function PlacesStrip() {
  return <nav className="kern-places" aria-label="Places" data-testid="places-strip" />;
}

function FolderArea(props: { docked?: boolean }) {
  const active = useTabs((s) => activeTab(s));
  // Slid in over a document, the panel shows the folder tab used last (design 4.3).
  const recent = useTabs((s) => recentFolderTab(s));
  const tab = active?.kind === "folder" ? active : recent;
  const region = props.docked ? { role: "region", "aria-label": "File manager" } : {};
  return (
    <div className="kern-folder-area" data-testid="folder-area" {...region}>
      {tab && <FolderView key={tab.id} tab={tab} />}
    </div>
  );
}

export function PlacesPanel(props: { overlay?: boolean }) {
  if (!props.overlay) {
    return (
      <>
        <PlacesStrip />
        <FolderArea docked />
      </>
    );
  }
  return (
    <section
      className="kern-panel kern-panel-left kern-overlay"
      aria-label="File manager"
      data-testid="places-panel"
    >
      <PlacesStrip />
      <FolderArea />
    </section>
  );
}
