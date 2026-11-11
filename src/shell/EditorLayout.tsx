// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { displayPath, isEditorWindow, type WireEntry, type WirePath } from "../ipc";
import { TextEditor } from "../editor/TextEditor";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  FolderOutput,
  Search,
  SquareTerminal,
} from "lucide-react";
import { FolderTree, type FolderTreeHandle } from "../files/FolderTree";
import { isFolder } from "../files/file-type";
import { openFiles } from "../files/open-entries";
import { SearchView } from "../files/SearchView";
import { openTerminalIn } from "../files/use-folder-tools";
import { toggleHidden, useEditorPanelOrder } from "../files/view-settings";
import { treeMenu } from "../files/tree-menu";
import { TreeOps } from "../files/TreeOps";
import { TreeSortButton } from "../files/TreeSortButton";
import { useTreeMenu } from "../files/tree-menu-store";
import { useViewSettings } from "../files/view-settings";
import { ActionMenu } from "../keys/ActionMenu";
import { currentContext, getAction, runAction, type Action } from "../keys/actions";
import { DROP_DOCS_ATTR } from "../ops/dnd";
import { showOpenErrors } from "../ops/open-error-store";
import { useOps } from "../ops/useOps";
import { LEFT_WIDTH_MAX, LEFT_WIDTH_MIN, useLayout } from "../store/layout";
import { usePanels } from "../store/panels";
import type { DocTab, Tab } from "../store/tabs";
import { FolderArea, PlacesStrip } from "./PlacesPanel";
import { OpenError } from "./OpenError";
import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { editorSide, type Side } from "./panel-order";
import { Splitter } from "./Splitter";
import { TabBar } from "./TabBar";
import { WelcomePane } from "./WelcomePane";
import { ensureTreeRoot } from "./layout-switch";

// The editor layout a resizable left column, a places strip
// over a folder tree rooted at the window's folder, that stays docked whatever tab is shown; the tab
// row and the tab take the centre; Pinned and Recent are folded away and slid in from the right, as
// beside a document in the file manager layout. The tab row's folder button and Ctrl+B show or
// hide the column; its three-line button and Ctrl+Alt+B, Pinned and Recent. The main window shows it
// when its layout is the editor; an editor window (`editor-<n>`) always does.

/** The divider between the column and the centre. */
function ColumnSplitter(props: { side: Side }) {
  const width = useLayout((s) => s.leftWidth);
  const setWidth = useLayout((s) => s.setLeftWidth);
  return (
    <Splitter
      width={width}
      min={LEFT_WIDTH_MIN}
      max={LEFT_WIDTH_MAX}
      setWidth={setWidth}
      grows={props.side === "left" ? "right" : "left"}
      label="Resize the folder column"
      className="kern-splitter"
      testId="column-splitter"
    />
  );
}

/** Says `text` where the tree shows its problems, else in the status bar. */
function treeNote(text: string): void {
  const ops = useTreeMenu.getState().ops;
  if (ops) ops.note(text);
  else useOps.getState().notify(text);
}

/**
 * The buttons of the tree's heading: the name search in the window's folder, a terminal at the
 * root, in an editor window the folder opened in the file manager, hidden items shown or not (the
 * window's choice, which folder tabs follow too), the order of the tree, and one button that closes
 * every folder while one is open and opens them all while none is.
 */
function TreeTools(props: {
  root: WirePath;
  tree: React.RefObject<FolderTreeHandle | null>;
  searching: boolean;
  onSearch(): void;
  /** Whether any folder below the root is open: the last button then closes them, else opens them. */
  anyOpen: boolean;
}) {
  const hidden = useViewSettings((s) => s.showHidden);
  const button = (label: string, Icon: typeof Search, onClick: () => void, pressed?: boolean) => (
    <button
      type="button"
      className="kern-icon-button kern-tree-tool"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={2} aria-hidden />
    </button>
  );
  return (
    <span className="kern-tree-tools" role="toolbar" aria-label="Folder tree">
      {button(`Search in ${displayPath(props.root)}`, Search, props.onSearch, props.searching)}
      {button(
        "Open terminal here",
        SquareTerminal,
        () => void openTerminalIn(props.root, treeNote)
      )}
      {isEditorWindow() &&
        button("Open in file manager", FolderOutput, () =>
          runAction(getAction("editor.openInFileManager"), currentContext())
        )}
      {button("Show hidden files", hidden ? Eye : EyeOff, () => void toggleHidden(), hidden)}
      <TreeSortButton />
      {props.anyOpen
        ? button("Collapse all", ChevronsDownUp, () => props.tree.current?.collapseAll())
        : button("Expand all", ChevronsUpDown, () => props.tree.current?.expandAll())}
    </span>
  );
}

/** The left column: the places strip on top, the folder tree below it. */
function LeftColumn(props: { side: Side }) {
  const root = useLayout((s) => s.treeRoot);
  const hidden = useViewSettings((s) => s.showHidden);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: WireEntry | null } | null>(null);
  const column = useRef<HTMLElement>(null);
  const tree = useRef<FolderTreeHandle>(null);
  const [searching, setSearching] = useState(false);
  const [anyOpen, setAnyOpen] = useState(false);
  // A new root ends a search of the old one.
  const [searchedRoot, setSearchedRoot] = useState(root);
  if (searchedRoot !== root) {
    setSearchedRoot(root);
    setSearching(false);
  }

  const closeSearch = useCallback(() => {
    setSearching(false);
    column.current?.querySelector<HTMLElement>("[role=tree]")?.focus();
  }, []);
  // A file found opens as from the tree; a folder found is shown in the tree.
  const onFound = useCallback((entry: WireEntry, newWindow: boolean) => {
    if (isFolder(entry)) {
      setSearching(false);
      tree.current?.reveal(entry.path);
      return;
    }
    void openFiles([entry.path], newWindow).then((errors) => showOpenErrors(entry.name, errors));
  }, []);

  // The empty part below the rows stands for the root.
  const onContextMenu = useCallback(
    (entry: WireEntry | null, x: number, y: number) => {
      useTreeMenu.getState().setCurrent(entry, root);
      setMenu({ x, y, entry });
    },
    [root]
  );
  const focusTree = useCallback(
    () => column.current?.querySelector<HTMLElement>("[role=tree]")?.focus(),
    []
  );

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
    <aside
      ref={column}
      className={props.side === "right" ? "kern-editor-left kern-side-right" : "kern-editor-left"}
      aria-label="Places and folders"
      data-testid="editor-left"
    >
      <PlacesStrip column />
      {root && <TreeOps scope={column} focusTree={focusTree} />}
      <div className="kern-editor-tree">
        {root ? (
          <>
            {searching && (
              <SearchView root={root} area="editor" onClose={closeSearch} onOpen={onFound} />
            )}
            {/* Kept while the search is on show, so the folders open in it stay open. */}
            <div className="kern-editor-tree-body" hidden={searching}>
              <FolderTree
                root={root}
                hidden={hidden}
                onRootGone={onRootGone}
                onContextMenu={onContextMenu}
                handle={tree}
                onOpenChange={setAnyOpen}
                tools={
                  <TreeTools
                    root={root}
                    tree={tree}
                    searching={searching}
                    onSearch={() => setSearching((on) => !on)}
                    anyOpen={anyOpen}
                  />
                }
              />
            </div>
          </>
        ) : (
          <p role="status" className="kern-place-note">
            No folder to show yet.
          </p>
        )}
      </div>
      {menu && (
        <ActionMenu
          sections={treeMenu(menu.entry)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
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
  const order = useEditorPanelOrder();
  const placesSide = editorSide(order, "places");
  // The divider is on the column's edge that faces the editor.
  const column =
    placesSide === "left" ? (
      <>
        <LeftColumn side="left" />
        <ColumnSplitter side="left" />
      </>
    ) : (
      <>
        <ColumnSplitter side="right" />
        <LeftColumn side="right" />
      </>
    );
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
      {leftOpen && placesSide === "left" && column}
      <div
        className="kern-editor-centre"
        // Files dropped from another program on an editor window's documents are opened there.
        {...(isEditorWindow() ? { [DROP_DOCS_ATTR]: "" } : {})}
      >
        <TabBar allow={props.allow} />
        {/* Pinned and Recent slide in over what is under the tab row, so the row's buttons stay. */}
        <div className="kern-editor-body">
          {props.children}
          <OpenError />
          {rightOpen && <PinnedRecentPanel overlay side={editorSide(order, "pinned")} />}
        </div>
      </div>
      {leftOpen && placesSide === "right" && column}
    </div>
  );
}
