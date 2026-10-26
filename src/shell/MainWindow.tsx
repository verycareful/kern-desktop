// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useShortcuts } from "../keys/useShortcuts";
import { usePanels } from "../store/panels";
import { activeTab, useTabs } from "../store/tabs";
import { PanelStub } from "./PanelStub";
import { PlacesPanel } from "./PlacesPanel";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import "./shell.css";

// Design 4.1 (folder tab: file manager left, Pinned and Recent right) and 4.3
// (document tab: both folded to stubs that slide the panels over the document).
export default function MainWindow() {
  useShortcuts();
  const tab = useTabs((s) => activeTab(s));
  const { leftOpen, rightOpen, toggleLeft, toggleRight } = usePanels();

  let body;
  if (!tab) {
    body = (
      <main className="kern-empty" data-testid="no-tab">
        <p>No tab is open.</p>
      </main>
    );
  } else if (tab.kind === "folder") {
    body = (
      <div className="kern-body kern-body-folder" data-testid="folder-body">
        <PlacesPanel />
        <SidePanel />
      </div>
    );
  } else {
    body = (
      <div className="kern-body kern-body-doc" data-testid="doc-body">
        <PanelStub side="left" expanded={leftOpen} onToggle={toggleLeft} />
        <main className="kern-doc-area" data-testid="doc-area" />
        <PanelStub side="right" expanded={rightOpen} onToggle={toggleRight} />
        {leftOpen && <PlacesPanel overlay />}
        {rightOpen && <SidePanel overlay />}
      </div>
    );
  }

  return (
    <div className="kern-window" data-testid="main-window">
      <TabBar />
      {body}
      <StatusBar />
    </div>
  );
}
