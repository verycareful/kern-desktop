// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { displayPath, isEditorWindow, type WireEntry, type WirePath } from "../ipc";
import { TextEditor } from "../editor/TextEditor";
import { FolderTree } from "../files/FolderTree";
import { TREE_MENU } from "../files/tree-menu";
import { useTreeMenu } from "../files/tree-menu-store";
import { useViewSettings } from "../files/view-settings";
import { ActionMenu } from "../keys/ActionMenu";
import type { Action } from "../keys/actions";
import { DROP_DOCS_ATTR } from "../ops/dnd";
import { useOps } from "../ops/useOps";
import { LEFT_WIDTH_MAX, LEFT_WIDTH_MIN, useLayout } from "../store/layout";
import { usePanels } from "../store/panels";
import type { DocTab, Tab } from "../store/tabs";
import { FolderArea, PlacesStrip } from "./PlacesPanel";
import { PanelStub } from "./PanelStub";
import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { Splitter } from "./Splitter";
import { TabBar } from "./TabBar";
import { WelcomePane } from "./WelcomePane";
import { ensureTreeRoot } from "./layout-switch";

// The editor layout a resizable left column, a places strip
// over a folder tree rooted at the window's folder, that stays docked whatever tab is shown; the tab
// row and the tab take the centre; Pinned and Recent are folded to the right stub, as beside a
// document in the file manager layout. Ctrl+B shows or hides the column. The main window shows it
// when its layout is the editor; an editor window (`editor-<n>`) always does.

/** The divider between the column and the centre. */
function ColumnSplitter() {
  const width = useLayout((s) => s.leftWidth);
  const setWidth = useLayout((s) => s.setLeftWidth);
  return (
    <Splitter
      width={width}
      min={LEFT_WIDTH_MIN}
      max={LEFT_WIDTH_MAX}
      setWidth={setWidth}
      grows="right"
      label="Resize the folder column"
      className="kern-splitter"
      testId="column-splitter"
    />
  );
}

/** The left column: the places strip on top, the folder tree below it. */
function LeftColumn() {
  const root = useLayout((s) => s.treeRoot);
  const hidden = useViewSettings((s) => s.showHidden);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const onContextMenu = useCallback((entry: WireEntry | null, x: number, y: number) => {
    // Nothing to act on in the empty part.
    if (!entry) return;
    useTreeMenu.getState().setCurrent(entry);
    setMenu({ x, y });
  }, []);

  // The root is gone: the tree moves to the nearest folder that is still there, and says so.
  const onRootGone = useCallback((nearest: WirePath | null) => {
    const gone = useLayout.getState().treeRoot;
    if (!nearest) return;
    useLayout.getState().setTreeRoot(nearest);
    useOps
      .getState()
      .notify(
        `${gone ? displayPath(gone) : "The folder"} is gone, so the tree now shows ${displayPath(nearest)}.`
      );
  }, []);

  return (
    <aside className="kern-editor-left" aria-label="Places and folders" data-testid="editor-left">
      <PlacesStrip column />
      <div className="kern-editor-tree">
        {root ? (
          <FolderTree
            root={root}
            hidden={hidden}
            onRootGone={onRootGone}
            onContextMenu={onContextMenu}
          />
        ) : (
          <p role="status" className="kern-place-note">
            No folder to show yet.
          </p>
        )}
      </div>
      {menu && (
        <ActionMenu sections={TREE_MENU} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}

/**
 * The centre of the editor layout below the tab row: the active folder or place tab, the editors of
 * the document tabs (every one stays mounted, the ones not shown hidden, so unsaved text, undo and
 * the watch on the file belong to the tab), or the welcome pane when no tab is open.
 */
export function EditorCentre(props: { tab: Tab | null; docs: DocTab[]; starting?: boolean }) {
  const { tab, docs } = props;
  return (
    <>
      {tab && tab.kind !== "doc" && <FolderArea docked />}
      <main
        className="kern-doc-area kern-editor-docs"
        data-testid="doc-area"
        hidden={tab?.kind !== "doc"}
      >
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
      {!tab &&
        (props.starting ? (
          <main className="kern-empty" data-testid="no-tab">
            <p role="status">Starting…</p>
          </main>
        ) : (
          <WelcomePane />
        ))}
    </>
  );
}

export function EditorLayout(props: {
  children: React.ReactNode;
  /** Limits the actions the tab row's menu offers (an editor window has no Trash). */
  allow?: (a: Action) => boolean;
}) {
  const leftOpen = useLayout((s) => s.leftOpen);
  const width = useLayout((s) => s.leftWidth);
  const { rightOpen } = usePanels();
  const rightWidth = useLayout((s) => s.rightWidth);
  const style = {
    "--editor-left-width": `${width}px`,
    "--shell-right-width": `${rightWidth}px`,
  } as CSSProperties;

  // The tree needs a folder: the main window finds one (Home, or the folder tab shown); an editor
  // window is told its folder by the backend.
  useEffect(() => {
    if (!isEditorWindow()) void ensureTreeRoot();
  }, []);

  return (
    <div
      className="kern-main kern-editor-frame"
      data-layout="editor"
      data-testid="main-grid"
      style={style}
    >
      {leftOpen && (
        <>
          <LeftColumn />
          <ColumnSplitter />
        </>
      )}
      <div
        className="kern-editor-centre"
        // Files dropped from another program on an editor window's documents are opened there.
        {...(isEditorWindow() ? { [DROP_DOCS_ATTR]: "" } : {})}
      >
        <TabBar allow={props.allow} />
        {props.children}
      </div>
      <PanelStub side="right" expanded={rightOpen} />
      {rightOpen && <PinnedRecentPanel overlay />}
    </div>
  );
}
