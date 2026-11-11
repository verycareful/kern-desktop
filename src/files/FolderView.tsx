// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Search,
  SquarePen,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  EVENT_DROP,
  displayPath,
  dragOut,
  on,
  pathKey,
  toWireError,
  type DragAction,
  type DropPayload,
  type WireError,
  type WirePath,
} from "../ipc";
import { ActionMenu } from "../keys/ActionMenu";
import { ActionButton } from "../shell/ActionButton";
import { FILE_KEYS_ATTR } from "../keys/file-keys";
import {
  DROP_AREA_ATTR,
  decideDrop,
  dropTargetValue,
  landingAt,
  modsOf,
  type DragModifiers,
} from "../ops/dnd";
import { logError } from "../ops/error-log";
import { errorText } from "../ops/error-text";
import { ErrorBanner } from "../ops/ErrorBanner";
import { useTabs, type FolderTab, type FolderViewState } from "../store/tabs";
import { Breadcrumb } from "./Breadcrumb";
import { OpenWithDialog } from "./OpenWithDialog";
import { SearchView } from "./SearchView";
import { useFolderTools } from "./use-folder-tools";
import { ConfirmBanner } from "./ConfirmBanner";
import { FileGrid } from "./FileGrid";
import { FileOpsUi } from "./FileOpsUi";
import { FileList } from "./FileList";
import { ROW_HEIGHT } from "./grid-layout";
import { useFolderUi, DEFAULT_SORT } from "./folder-ui";
import { registerFolder, type MoveTo } from "./folder-controller";
import { useFolderStatus } from "./folder-status";
import { folderMenu } from "./folder-menu";
import { GoneBanner } from "./GoneBanner";
import { LocationBar } from "./LocationBar";
import { useFileOps } from "./use-file-ops";
import { useItemDrag } from "./use-item-drag";
import { useKeepKeyboard } from "./use-keep-keyboard";
import { OPEN_CONFIRM_ABOVE, openEntries } from "./open-entries";
import {
  click,
  ctrlClick,
  move,
  rubberBand,
  seedCursor,
  selectAll,
  selectNone,
  shiftClick,
  type Sel,
} from "./selection";
import { isFolder } from "./file-type";
import {
  loadViewSettings,
  useSingleClick,
  useViewSettings,
  useViewSettingsSync,
} from "./view-settings";
import { useFolder } from "./useFolder";
import { FlashSpan, RepeatFlash } from "../ops/repeat-flash";
import "../ops/ops.css";
import "./files.css";

function ErrorText(props: { error: WireError }) {
  return (
    <>
      {props.error.kind}: {props.error.message}
    </>
  );
}

// The folder list beside the places, with the location above it.
// Shows the tab's folder as a list or a grid, in the order the tab is sorted.
export function FolderView(props: { tab: FolderTab }) {
  useViewSettingsSync();
  const { loaded, error } = useViewSettings();
  if (!loaded) {
    return (
      <div className="kern-files" data-testid="folder-view">
        {error ? (
          <div role="alert" className="kern-banner">
            <span>
              Settings could not be read: <ErrorText error={error} />
            </span>
            <RepeatFlash watch={error} />
            <button type="button" className="kern-button" onClick={() => void loadViewSettings()}>
              Retry
            </button>
          </div>
        ) : (
          <p role="status" className="kern-note-body">
            Loading…
          </p>
        )}
      </div>
    );
  }
  return <LoadedFolder tab={props.tab} />;
}

function LoadedFolder({ tab }: { tab: FolderTab }) {
  const { showHidden, viewMode, folderMenu: menuShape, error: settingsError } = useViewSettings();
  const singleClick = useSingleClick("centre");
  const sort = useFolderUi((s) => s.sort[tab.id] ?? DEFAULT_SORT);
  const key = pathKey(tab.path);
  const isActive = useTabs((s) => s.activeId === tab.id);
  // What this tab's view kept when it was last unmounted. It is read once
  // at mount, applies to the folder it was kept in, and is dropped for good on
  // the first move to another folder: coming back by Back starts fresh too.
  const [kept, setKept] = useState<FolderViewState | null>(() => {
    const saved = useTabs.getState().views[tab.id];
    return saved && saved.pathKey === key ? saved : null;
  });
  const keptHere = kept && kept.pathKey === key ? kept : null;
  const folder = useFolder(tab.id, tab.path, {
    hidden: showHidden,
    sortBy: sort.by,
    sortDir: sort.dir,
    seed: keptHere,
  });
  const { entries, sel, dispatch, refresh, relist, selectKeys } = folder;
  // Used up by the first listing (the list takes its scroll offset as it mounts)
  // or by a move to another folder, whichever comes first.
  useEffect(() => {
    if (kept && (folder.phase === "ready" || kept.pathKey !== key)) setKept(null);
  }, [kept, key, folder.phase]);
  const [editing, setEditing] = useState(false);
  // The name search shows in place of the items; another folder ends it.
  const [searching, setSearching] = useState(false);
  // A selection asked for in one folder is not for the next one the tab shows.
  const shownKey = useRef(key);
  useEffect(() => {
    setSearching(false);
    if (shownKey.current === key) return;
    shownKey.current = key;
    useTabs.getState().clearSelectRequest(tab.id);
  }, [key, tab.id]);
  const [openErrors, setOpenErrors] = useState<WireError[]>([]);
  const [revealTick, setRevealTick] = useState(0);
  // What could not be selected, apart from the open errors, which are replaced by each open.
  const [selectNotes, setSelectNotes] = useState<WireError[]>([]);
  // Items another program asked to have selected here (kern://select), once listed.
  const selectRequest = useTabs((s) => s.selectRequests[tab.id]);
  useEffect(() => {
    // A request made during a search waits until the items are on show again.
    if (!selectRequest || folder.phase !== "ready" || searching) return;
    useTabs.getState().clearSelectRequest(tab.id);
    const listed = new Set(entries.map((e) => pathKey(e.path)));
    const wanted = selectRequest.filter((p) => listed.has(pathKey(p)));
    selectKeys(wanted.map(pathKey));
    setRevealTick((n) => n + 1);
    const missing = selectRequest.filter((p) => !listed.has(pathKey(p)));
    if (missing.length > 0) {
      // A dotfile is not listed while hidden files are off: say that, not that it is absent.
      const hidden = (p: WirePath) =>
        !showHidden && displayPath(p).split("/").pop()!.startsWith(".");
      const describe = (p: WirePath) =>
        `${displayPath(p)} (${hidden(p) ? "hidden, Ctrl+H shows hidden files" : "not in this folder"})`;
      const message = `Not selected: ${missing.map(describe).join(", ")}`;
      logError("select", message);
      setSelectNotes((notes) => [
        ...notes,
        { kind: "NotFound", message, path: null, details: null },
      ]);
    }
  }, [selectRequest, folder.phase, entries, selectKeys, tab.id, showHidden, searching]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [columns, setColumns] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null);
  // The list takes the keyboard; an empty folder's note does when there is no list.
  const keyboardTarget = useCallback(() => root.current ?? note.current, []);
  const keep = useKeepKeyboard(files, keyboardTarget);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // After a click on the header, the breadcrumb or a view button the keyboard
  // belongs to the list again, once there is a list to take it.
  const focusSoon = useRef(false);
  const [asking, setAsking] = useState<{ list: typeof entries; newWindow: boolean } | null>(null);
  const cancelAsking = useCallback(() => {
    focusSoon.current = true;
    setAsking(null);
  }, []);
  // Navigates this view's own tab, which is not the active one when the panel is slid in over a document.
  const navigate = useCallback(
    (p: WirePath) => {
      focusSoon.current = true;
      useTabs.getState().navigateTab(tab.id, p);
    },
    [tab.id]
  );

  // The controller reads the latest view state without being re-registered. It is stored in a
  // layout effect, which runs before the browser can deliver another event: a drag or key that
  // lands right after the commit that removed a row must not still find that row.
  const latest = useRef({ entries, sel, viewMode, columns, phase: folder.phase, searching });
  useLayoutEffect(() => {
    latest.current = { entries, sel, viewMode, columns, phase: folder.phase, searching };
  });
  // What the file operations act on: the selection, in list order, and nothing else. An item
  // that is only outlined (the cursor) is not selected and is never copied, cut, trashed,
  // deleted, renamed or dragged.
  // While the search is on show the items are not, so there is no selection to act on, whatever
  // has been selected meanwhile (Ctrl+A, the result of an operation): every action below reads
  // the selection through this.
  const selected = useCallback(() => {
    const { entries: es, sel: s, searching: hidden } = latest.current;
    if (hidden) return [];
    return [...s.selected].sort((a, b) => a - b).flatMap((i) => (es[i] ? [es[i]] : []));
  }, []);
  // What Enter opens: the selection, or else the outlined item.
  const toOpen = useCallback(() => {
    const picked = selected();
    const { entries: es, sel: s, searching: hidden } = latest.current;
    const outlined = s.cursor === null || hidden ? undefined : es[s.cursor];
    return picked.length === 0 && outlined ? [outlined] : picked;
  }, [selected]);

  // The view state is saved as the view unmounts (a tab switch, or the
  // folder panel folding away), from refs because the DOM is gone by then.
  const scrollTop = useRef(keptHere?.scrollTop ?? 0);
  const onScrollCapture = useCallback((e: React.UIEvent) => {
    if ((e.target as Element).classList.contains("kern-scroll")) {
      scrollTop.current = (e.target as Element).scrollTop;
    }
  }, []);
  // A new folder starts at the top; the kept view's offset stays until then.
  const scrolledKey = useRef(key);
  useEffect(() => {
    if (scrolledKey.current === key) return;
    scrolledKey.current = key;
    scrollTop.current = 0;
  }, [key]);
  const ending = useRef({ phase: folder.phase, key });
  useLayoutEffect(() => {
    ending.current = { phase: folder.phase, key };
  });
  useEffect(
    () => () => {
      const { entries: es, sel: s } = latest.current;
      const end = ending.current;
      // A view that never listed has nothing new to keep; what was kept stays.
      if (end.phase !== "ready") return;
      const name = (i: number | null) => {
        const e = i === null ? undefined : es[i];
        return e ? pathKey(e.path) : null;
      };
      useTabs.getState().saveView(tab.id, {
        pathKey: end.key,
        scrollTop: scrollTop.current,
        selected: [...s.selected].sort((x, y) => x - y).flatMap((i) => name(i) ?? []),
        anchor: name(s.anchor),
        cursor: name(s.cursor),
      });
    },
    [tab.id]
  );

  const open = useCallback(
    async (list: typeof entries, newWindow: boolean) => {
      const errors = await openEntries(list, newWindow, tab.id).catch((e: unknown) => [
        toWireError(e),
      ]);
      if (alive.current) setOpenErrors(errors);
      errors.forEach((e) => logError("open", errorText(e)));
    },
    [tab.id]
  );

  // What the banners below say is also written to the error log, once for each time it appears.
  useEffect(() => {
    if (folder.sortError)
      logError("folder", `The list could not be sorted: ${errorText(folder.sortError)}`);
  }, [folder.sortError]);
  useEffect(() => {
    if (folder.watchError) {
      logError(
        "folder",
        `Changes to this folder will not appear by themselves: ${errorText(folder.watchError)}`
      );
    }
  }, [folder.watchError]);
  const openOrAsk = useCallback(
    (list: typeof entries, newWindow: boolean) => {
      if (list.length > OPEN_CONFIRM_ABOVE) setAsking({ list, newWindow });
      else void open(list, newWindow);
    },
    [open]
  );

  const fileOps = useFileOps({
    folder: tab.path,
    selected,
    // Nothing is created or pasted into a folder whose items are not on show.
    ready: () => latest.current.phase === "ready" && !latest.current.searching,
    relist,
    selectKeys,
    reveal: () => setRevealTick((t) => t + 1),
    // The keyboard goes back to a name being edited, else to the list.
    focusList: () =>
      (
        files.current?.querySelector<HTMLElement>(".kern-rename-input") ?? keyboardTarget()
      )?.focus(),
  });

  const { cancelAsk: cancelOpsQuestion, closeNaming } = fileOps;
  const tools = useFolderTools({
    folder: tab.path,
    listed: () => latest.current.phase === "ready",
    selected,
  });

  // Something dropped on a folder (a pointer drag inside Kern, or a drop from another
  // application): the modifier keys and what the other application offers decide when they
  // can, and otherwise the filesystems do, item by item (use-file-ops.ts).
  const { drop: dropItems, fail } = fileOps;
  const dropOn = useCallback(
    (
      sources: WirePath[],
      dest: WirePath,
      how: { mods: DragModifiers | null; offered?: readonly DragAction[] }
    ) => {
      void dropItems(decideDrop(how.mods, how.offered ?? null), sources, dest);
    },
    [dropItems]
  );
  const drag = useItemDrag({
    itemsFor: (key) => {
      const { entries: es, sel: s } = latest.current;
      const at = es.findIndex((e) => pathKey(e.path) === key);
      const only = es[at];
      if (!only) return [];
      if (s.selected.has(at)) return selected();
      dispatch((x) => click(x, at));
      return [only];
    },
    onDrop: (sources, dest, mods) => dropOn(sources, dest, { mods }),
    onLeave: (sources) => {
      dragOut(sources).catch(fail);
    },
  });

  // A drop from another application lands where the pointer was: on the folder row or Places
  // entry under it, or on the body of the view. A place that takes nothing, or a point that
  // cannot be resolved, is not this view's to act on; the window says why (ops/DropHover.tsx).
  const dropState = useRef({ isActive });
  useLayoutEffect(() => {
    dropState.current = { isActive };
  });
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    on(EVENT_DROP, (drop: DropPayload) => {
      if (!dropState.current.isActive || drop.paths.length === 0) return;
      const landing = landingAt(
        drop.position,
        drop.view,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        drop.paths
      );
      if (!landing.ok) return;
      dropOn(drop.paths, landing.path, { mods: modsOf(drop.modifier), offered: drop.offered });
    }).then(
      (u) => (live ? (off = u) : u()),
      (e: unknown) => live && fail(e)
    );
    return () => {
      live = false;
      off?.();
    };
  }, [dropOn, fail]);

  useEffect(() => {
    const step = (to: MoveTo): number => {
      const { viewMode: mode, columns: cols } = latest.current;
      const row = mode === "grid" ? cols : 1;
      return { up: -row, down: row, left: -1, right: 1, first: -Infinity, last: Infinity }[to];
    };
    return registerFolder(tab.id, {
      selectAll: () => {
        if (!latest.current.searching) dispatch((s, n) => selectAll(s, n));
      },
      selectNone: () => dispatch((s) => selectNone(s)),
      hasSelection: () => selected().length > 0,
      selectedPaths: () => selected().map((e) => e.path),
      canOpen: () => toOpen().length > 0,
      canMove: (to) =>
        !latest.current.searching &&
        latest.current.entries.length > 0 &&
        (latest.current.viewMode === "grid" || (to !== "left" && to !== "right")),
      move: (to, extend) => {
        if (latest.current.searching) return;
        dispatch((s, n) => move(s, step(to), extend, n));
        setRevealTick((t) => t + 1);
      },
      open: (newWindow) => openOrAsk(toOpen(), newWindow),
      refresh,
      editLocation: () => setEditing(true),
      canSearch: () => latest.current.phase === "ready",
      search: () => {
        if (latest.current.searching) {
          // Ctrl+F from the results: back to the query.
          files.current?.querySelector<HTMLInputElement>('input[type="search"]')?.select();
          return;
        }
        // The selection is not on show during a search, so nothing may act on it, and no
        // question about it (Delete permanently, open many) or new name stays open.
        dispatch((s) => selectNone(s));
        cancelOpsQuestion();
        closeNaming();
        cancelAsking();
        setSearching(true);
      },
      ...fileOps.controller,
      copyPath: tools.copyPath,
      canOpenTerminal: tools.canOpenTerminal,
      openTerminalHere: tools.openTerminalHere,
      canOpenWith: tools.canOpenWith,
      openWith: tools.openWith,
      canOpenAsEditor: tools.canOpenAsEditor,
      openAsEditor: tools.openAsEditor,
      editorRoot: tools.editorRoot,
    });
  }, [
    tab.id,
    dispatch,
    openOrAsk,
    refresh,
    selected,
    toOpen,
    fileOps.controller,
    cancelOpsQuestion,
    closeNaming,
    cancelAsking,
    tools,
  ]);

  // The status bar's counts.
  useEffect(() => {
    if (folder.phase !== "ready") {
      useFolderStatus.getState().clear(tab.id);
      return;
    }
    let bytes = 0;
    let folders = 0;
    // During a search the selection is not on show and is not counted.
    const counted = searching ? new Set<number>() : sel.selected;
    for (const i of counted) {
      const e = entries[i];
      if (!e) continue;
      if (isFolder(e)) folders++;
      else bytes += e.len;
    }
    useFolderStatus.getState().set(tab.id, {
      items: entries.length,
      selected: counted.size,
      selectedBytes: bytes,
      selectedFolders: folders,
    });
  }, [tab.id, folder.phase, entries, sel, searching]);
  useEffect(() => () => useFolderStatus.getState().clear(tab.id), [tab.id]);

  // The toolbar's buttons ask the controller whether they can run, and it reads what the effects
  // above store, after the render that drew them. So once the folder's phase or the search
  // changes, the view is drawn once more, with the buttons reading what is stored now.
  const [, setToolsDrawnFor] = useState("");
  useEffect(() => {
    setToolsDrawnFor(`${folder.phase}\n${searching}`);
  }, [folder.phase, searching]);

  // With single-click opening, a plain click selects the item and opens it; a click with Ctrl,
  // Meta or Shift only selects, so a selection can still be built with the mouse. The second
  // click of a double-click (`detail` 2 or more) selects and does not open again.
  const onItemClick = useCallback(
    (i: number, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) dispatch((s) => ctrlClick(s, i));
      else if (e.shiftKey) dispatch((s) => shiftClick(s, i));
      else {
        dispatch((s) => click(s, i));
        const entry = latest.current.entries[i];
        if (singleClick && e.detail <= 1 && entry) openOrAsk([entry], false);
      }
    },
    [dispatch, openOrAsk, singleClick]
  );
  // The keyboard goes back to the list once it has been navigated or re-sorted.
  useEffect(() => {
    if (!focusSoon.current || folder.phase === "loading") return;
    focusSoon.current = false;
    keyboardTarget()?.focus();
  });

  const onItemDoubleClick = useCallback(
    (i: number, e: React.MouseEvent) => {
      if (singleClick) return;
      const entry = latest.current.entries[i];
      if (!entry) return;
      dispatch((s) => click(s, i));
      openOrAsk([entry], e.ctrlKey || e.metaKey);
    },
    [dispatch, openOrAsk, singleClick]
  );
  const onContextMenu = useCallback(
    (i: number | null, e: React.MouseEvent) => {
      e.preventDefault();
      if (i !== null && !latest.current.sel.selected.has(i)) dispatch((s) => click(s, i));
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [dispatch]
  );
  const onBand = useCallback(
    (indices: number[], additive: boolean, base: Sel) =>
      dispatch(() => rubberBand(base, indices, additive)),
    [dispatch]
  );
  const onSeedCursor = useCallback(() => dispatch((s, n) => seedCursor(s, n)), [dispatch]);
  const onBackgroundClick = useCallback(() => {
    dispatch((s) => selectNone(s));
    root.current?.focus();
  }, [dispatch]);

  const items = {
    entries,
    sel,
    onItemClick,
    onItemDoubleClick,
    onContextMenu,
    onBand,
    onBackgroundClick,
    onSeedCursor,
    cutFolder: tab.path,
    rename: fileOps.renaming
      ? {
          state: fileOps.renaming,
          onChange: fileOps.editRename,
          onCommit: () => void fileOps.commitRename(),
          onCancel: fileOps.cancelRename,
        }
      : null,
  };

  let body;
  switch (folder.phase) {
    case "loading":
      body = (
        <p role="status" className="kern-note-body">
          {folder.sorting ? "Sorting…" : "Loading…"}
        </p>
      );
      break;
    case "error":
      body = (
        <div role="alert" className="kern-banner">
          <span>
            This folder could not be read: <ErrorText error={folder.error!} />
          </span>
          <button type="button" className="kern-button" onClick={refresh}>
            Retry
          </button>
        </div>
      );
      break;
    case "gone":
      body = (
        <GoneBanner
          path={tab.path}
          ancestor={folder.gone?.ancestor ?? null}
          searching={folder.gone?.searching ?? false}
          onGo={navigate}
        />
      );
      break;
    default:
      body =
        entries.length === 0 ? (
          <div
            ref={note}
            tabIndex={-1}
            className="kern-note"
            data-testid="folder-empty"
            onContextMenu={(e) => onContextMenu(null, e)}
          >
            <FolderOpen size={30} strokeWidth={1.8} aria-hidden />
            <p className="kern-note-title">This folder is empty</p>
            {!showHidden && (
              <p className="kern-note-body">Hidden files are not shown (Ctrl+H shows them).</p>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <FileGrid
            key={key}
            {...items}
            thumbKey={`thumbs:${tab.id}`}
            onColumns={setColumns}
            rootRef={root}
            revealTick={revealTick}
            initialScroll={keptHere?.scrollTop ?? 0}
          />
        ) : (
          <FileList
            key={key}
            {...items}
            rowHeight={ROW_HEIGHT}
            sortBy={sort.by}
            sortDir={sort.dir}
            sortFailed={folder.sortError !== null}
            onSort={(by) => {
              focusSoon.current = true;
              useFolderUi.getState().chooseSort(tab.id, by);
            }}
            rootRef={root}
            revealTick={revealTick}
            initialScroll={keptHere?.scrollTop ?? 0}
          />
        );
  }

  const refocus = () => (focusSoon.current = true);

  return (
    <div
      ref={files}
      className="kern-files"
      data-testid="folder-view"
      data-view={viewMode}
      {...{ [FILE_KEYS_ATTR]: "" }}
      onFocus={keep.onFocus}
      onBlur={keep.onBlur}
    >
      {isActive && (
        <div className="kern-folder-toolbar" role="toolbar" aria-label="Folder">
          <ActionButton id="nav.back" icon={ArrowLeft} targetId={tab.id} />
          <ActionButton id="nav.forward" icon={ArrowRight} targetId={tab.id} />
          <ActionButton id="nav.up" icon={ArrowUp} targetId={tab.id} />
          <span className="kern-toolbar-sep" aria-hidden />
          <ActionButton id="folder.new.folder" icon={FolderPlus} targetId={tab.id} />
          <ActionButton id="folder.search" icon={Search} targetId={tab.id} />
          <ActionButton id="folder.terminal" icon={SquareTerminal} targetId={tab.id} />
          <span className="kern-toolbar-sep" aria-hidden />
          <div className="kern-view-toggle" role="group" aria-label="View">
            <ActionButton
              id="folder.view.list"
              icon={List}
              targetId={tab.id}
              pressed={viewMode === "list"}
              enabled
              after={refocus}
            />
            <ActionButton
              id="folder.view.grid"
              icon={LayoutGrid}
              targetId={tab.id}
              pressed={viewMode === "grid"}
              enabled
              after={refocus}
            />
          </div>
          <ActionButton
            id="folder.hidden.toggle"
            icon={showHidden ? Eye : EyeOff}
            targetId={tab.id}
            pressed={showHidden}
            after={refocus}
          />
          <span className="kern-toolbar-fill" />
          <ActionButton id="folder.openAsEditor" icon={SquarePen} targetId={tab.id} />
        </div>
      )}
      <div className="kern-files-bar">
        {editing ? (
          <LocationBar
            path={tab.path}
            onNavigate={navigate}
            onClose={(how) => {
              setEditing(false);
              // Enter and Escape hand the keyboard to the list; focus that left on its own stays where it went.
              if (how === "done") keyboardTarget()?.focus();
            }}
          />
        ) : (
          <Breadcrumb path={tab.path} onNavigate={navigate} onEdit={() => setEditing(true)} />
        )}
      </div>
      {settingsError && (
        <div role="alert" className="kern-banner">
          <span>
            Settings: <ErrorText error={settingsError} />
          </span>
          <RepeatFlash watch={settingsError} />
        </div>
      )}
      {folder.sortError && (
        <div role="alert" className="kern-banner">
          <span>
            The list could not be sorted, so it is in the order the folder gave it. Choosing a sort
            tries again. <ErrorText error={folder.sortError} />
          </span>
          <RepeatFlash watch={folder.sortError} />
        </div>
      )}
      {folder.watchError && (
        <div role="alert" className="kern-banner">
          <span>
            Changes to this folder will not appear by themselves (press F5 to refresh):{" "}
            <ErrorText error={folder.watchError} />
          </span>
          <RepeatFlash watch={folder.watchError} />
        </div>
      )}
      {selectNotes.length > 0 && (
        <ErrorBanner onDismiss={() => setSelectNotes([])} watch={selectNotes}>
          <ul>
            {selectNotes.map((e, i) => (
              <li key={i}>
                <ErrorText error={e} />
              </li>
            ))}
          </ul>
        </ErrorBanner>
      )}
      {openErrors.length > 0 && (
        <ErrorBanner onDismiss={() => setOpenErrors([])} watch={openErrors}>
          <ul>
            {openErrors.map((e, i) => (
              <li key={i}>
                <ErrorText error={e} />
              </li>
            ))}
          </ul>
        </ErrorBanner>
      )}
      {asking && (
        <ConfirmBanner
          label="Open many items"
          message={`Open ${asking.list.length} items at once? Each opens a tab, a window or an application.`}
          confirmLabel={`Open ${asking.list.length} items`}
          scope={files}
          active={isActive}
          onConfirm={() => {
            const { list, newWindow } = asking;
            setAsking(null);
            void open(list, newWindow);
          }}
          onCancel={cancelAsking}
        />
      )}
      {tools.notes.length > 0 && (
        <div role="alert" className="kern-banner">
          <ul>
            {tools.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <FlashSpan count={tools.noteRepeats} />
          <button
            type="button"
            className="kern-icon-button"
            aria-label="Dismiss"
            onClick={tools.dismissNotes}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
      {tools.choosing && <OpenWithDialog entry={tools.choosing} onClose={tools.closeOpenWith} />}
      <FileOpsUi ops={fileOps} scope={files} active={isActive} />
      {folder.phase === "ready" && folder.sorting && (
        <p role="status" className="kern-note-body">
          Sorting…
        </p>
      )}
      {searching ? (
        <SearchView
          root={tab.path}
          area="centre"
          onClose={() => {
            focusSoon.current = true;
            setSearching(false);
          }}
          onOpen={(entry, newWindow) => {
            // A folder opened from the results is shown here, which ends the search.
            if (isFolder(entry) && !newWindow) navigate(entry.path);
            else openOrAsk([entry], newWindow);
          }}
        />
      ) : (
        <div
          className="kern-files-body"
          // Where a drop from another application on the list itself lands (ops/dnd.ts).
          {...(folder.phase === "ready" ? { [DROP_AREA_ATTR]: dropTargetValue(tab.path) } : {})}
          onScrollCapture={onScrollCapture}
          onPointerDown={drag.onPointerDown}
        >
          {body}
        </div>
      )}
      <div ref={drag.ghost} className="kern-drag-ghost" aria-hidden hidden />
      {menu && (
        <ActionMenu
          sections={folderMenu(menuShape)}
          x={menu.x}
          y={menu.y}
          targetId={tab.id}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
