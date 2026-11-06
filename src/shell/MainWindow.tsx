// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, type CSSProperties } from "react";
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import { useLayout } from "../store/layout";
import { EditorCentre, EditorLayout } from "./EditorLayout";
import { useLayoutSync } from "./use-layout-sync";
import { closeFolderTabs } from "./layout-switch";
import { useSettingsReportNotice } from "../settings/settings-reports";
import { OpsHost } from "../ops/OpsHost";
import { usePanels } from "../store/panels";
import { TextEditor } from "../editor/TextEditor";
import { RestoreBar } from "./RestoreBar";
import { activeTab, isPlaceTab, useTabs, type DocTab } from "../store/tabs";
import { ClosePrompt } from "./ClosePrompt";
import { PlacesPanel } from "./PlacesPanel";
import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { usePinnedRecent } from "./pinned-recent-store";
import { PropertiesHost } from "../files/PropertiesHost";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import "./shell.css";

// The places strip and Pinned and Recent run the full
// height of the window (the strip on the left, Pinned and Recent on the right,
// as wide as the user dragged it); the tab row sits over the folder area between them. In a document tab
// the tab row spans the window and both panels are folded away, each slid over the document from
// its edge by its button on the tab row. The status bar spans the bottom.
export default function MainWindow(props: { openingHome?: boolean; starting?: boolean }) {
  useShortcuts();
  // Hidden files, the view, the interface size and what a new tab opens.
  useViewSettingsSync();
  useSettingsReportNotice();
  // The layout is the setting; the columns and the tree are remembered (layout.json).
  useLayoutSync(true);
  const editorLayout = useLayout((s) => s.layout === "editor");
  // No layout is drawn until the stored one has been read, so the layout the window was left in
  // is the first one it shows. A layout that cannot be read still ends the wait (the defaults
  // stand and the failure is said, use-layout-sync.ts).
  const layoutReady = useLayout((s) => s.loaded);
  const rightWidth = useLayout((s) => s.rightWidth);
  // Pinned and Recent is followed while the window is open, not only while its panel shows:
  // a document tab folds the panel away, and Ctrl+D there reads whether the document is pinned.
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void usePinnedRecent
      .getState()
      .follow({ prune: false })
      .then((off) => (live ? (stop = off) : off()));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  const tab = useTabs((s) => activeTab(s));
  const tabs = useTabs((s) => s.tabs);
  const { leftOpen, rightOpen } = usePanels();
  const docs = tabs.filter((t): t is DocTab => t.kind === "doc");
  // The editor layout holds no folder tabs, however they came (a start with tabs open, a switch).
  // The tree takes its folder from the folder tab in front first (EditorLayout, whose effect runs
  // before this one).
  const hasFolderTab = tabs.some((t) => t.kind === "folder");
  useEffect(() => {
    if (layoutReady && editorLayout && hasFolderTab) closeFolderTabs();
  }, [layoutReady, editorLayout, hasFolderTab]);

  let layout: "folder" | "doc" | "none";
  let body;
  if (!tab) {
    layout = "none";
    body = (
      <main className="kern-empty" data-testid="no-tab">
        {props.starting && <p role="status">Starting…</p>}
        {!props.starting && props.openingHome && <p>Opening the new tab folder…</p>}
      </main>
    );
  } else if (tab.kind === "folder" || isPlaceTab(tab)) {
    // The Trash and the Library take the folder area; the strip and Pinned and Recent are as for a folder.
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
  // not to which tab is on show. The panels slid over the document belong to
  // the document layout only.
  const docBody = docs.length > 0 && (
    <div className="kern-body-doc" hidden={layout !== "doc"} data-testid="doc-body">
      <main className="kern-doc-area" data-testid="doc-area">
        {docs.map((d) => (
          <TextEditor
            key={d.id}
            tabId={d.id}
            path={d.path}
            active={d.id === tab?.id}
            handed={d.handed}
            registered={d.registered}
          />
        ))}
      </main>
      {layout === "doc" && leftOpen && <PlacesPanel overlay />}
      {layout === "doc" && rightOpen && <PinnedRecentPanel overlay />}
    </div>
  );

  return (
    <div className="kern-window" data-testid="main-window">
      <RestoreBar />
      {!layoutReady ? null : editorLayout ? (
        <EditorLayout>
          <EditorCentre tab={tab} docs={docs} starting={props.starting} />
        </EditorLayout>
      ) : (
        <div
          className="kern-main"
          data-layout={layout}
          data-testid="main-grid"
          style={{ "--shell-right-width": `${rightWidth}px` } as CSSProperties}
        >
          <TabBar />
          {body}
          {docBody}
        </div>
      )}
      <OpsHost />
      <PropertiesHost />
      <StatusBar />
      <ClosePrompt />
    </div>
  );
}
