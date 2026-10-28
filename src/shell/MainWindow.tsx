// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import { usePanels } from "../store/panels";
import { activeTab, useTabs } from "../store/tabs";
import { PanelStub } from "./PanelStub";
import { PlacesPanel } from "./PlacesPanel";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import "./shell.css";

// Design 4.1: the places strip and Pinned and Recent run the full
// height of the window (the strip on the left, Pinned and Recent on the right
// third); the tab row sits over the folder area between them. In a document tab
// (4.3) the tab row spans the window and both panels are folded to stubs that
// slide them over the document. The status bar spans the bottom.
export default function MainWindow(props: { openingHome?: boolean; starting?: boolean }) {
  useShortcuts();
  // The interface size actions step the stored size whatever tab is shown.
  useViewSettingsSync();
  const tab = useTabs((s) => activeTab(s));
  const { leftOpen, rightOpen } = usePanels();

  let layout: "folder" | "doc" | "none";
  let body;
  if (!tab) {
    layout = "none";
    body = (
      <main className="kern-empty" data-testid="no-tab">
        {props.starting && <p role="status">Starting…</p>}
        {!props.starting && props.openingHome && <p>Opening the Home folder…</p>}
      </main>
    );
  } else if (tab.kind === "folder" || tab.kind === "trash") {
    // The Trash takes the folder area; the strip and Pinned and Recent are as for a folder.
    layout = "folder";
    body = (
      <>
        <PlacesPanel />
        <SidePanel />
      </>
    );
  } else {
    layout = "doc";
    body = (
      <div className="kern-body-doc" data-testid="doc-body">
        <PanelStub side="left" expanded={leftOpen} />
        <main className="kern-doc-area" data-testid="doc-area" />
        <PanelStub side="right" expanded={rightOpen} />
        {leftOpen && <PlacesPanel overlay />}
        {rightOpen && <SidePanel overlay />}
      </div>
    );
  }

  return (
    <div className="kern-window" data-testid="main-window">
      <div className="kern-main" data-layout={layout} data-testid="main-grid">
        <TabBar />
        {body}
      </div>
      <StatusBar />
    </div>
  );
}
