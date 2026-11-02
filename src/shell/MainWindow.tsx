// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import { OpsHost } from "../ops/OpsHost";
import { usePanels } from "../store/panels";
import { TextEditor } from "../editor/TextEditor";
import { activeTab, isPlaceTab, useTabs, type DocTab } from "../store/tabs";
import { PanelStub } from "./PanelStub";
import { PlacesPanel } from "./PlacesPanel";
import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { PropertiesHost } from "../files/PropertiesHost";
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
  const tabs = useTabs((s) => s.tabs);
  const { leftOpen, rightOpen } = usePanels();
  const docs = tabs.filter((t): t is DocTab => t.kind === "doc");

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
  } else if (tab.kind === "folder" || isPlaceTab(tab)) {
    // The Trash and All documents take the folder area; the strip and Pinned and Recent are as for a folder.
    layout = "folder";
    body = (
      <>
        <PlacesPanel />
        <PinnedRecentPanel />
      </>
    );
  } else {
    layout = "doc";
    body = null;
  }

  // Every document tab keeps its editor mounted, the ones not shown hidden: the
  // unsaved text, the undo history and the watch on the file belong to the tab,
  // not to which tab is on show. The panels folded to stubs (4.3) belong to the
  // document layout only.
  const docBody = docs.length > 0 && (
    <div className="kern-body-doc" hidden={layout !== "doc"} data-testid="doc-body">
      {layout === "doc" && <PanelStub side="left" expanded={leftOpen} />}
      <main className="kern-doc-area" data-testid="doc-area">
        {docs.map((d) => (
          <TextEditor key={d.id} tabId={d.id} path={d.path} active={d.id === tab?.id} />
        ))}
      </main>
      {layout === "doc" && <PanelStub side="right" expanded={rightOpen} />}
      {layout === "doc" && leftOpen && <PlacesPanel overlay />}
      {layout === "doc" && rightOpen && <PinnedRecentPanel overlay />}
    </div>
  );

  return (
    <div className="kern-window" data-testid="main-window">
      <div className="kern-main" data-layout={layout} data-testid="main-grid">
        <TabBar />
        {body}
        {docBody}
      </div>
      <OpsHost />
      <PropertiesHost />
      <StatusBar />
    </div>
  );
}
