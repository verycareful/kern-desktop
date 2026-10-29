// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, LayoutGrid, List, X } from "lucide-react";
import {
  EVENT_DROP,
  displayPath,
  dragOut,
  on,
  pathKey,
  toWireError,
  type DropPayload,
  type WireError,
  type WirePath,
} from "../ipc";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import { actions, currentContext, getAction, runAction } from "../keys/actions";
import { canDropOn, decideDrop, dropTargetAt, toCssPoint, type DragModifiers } from "../ops/dnd";
import { zoomFactor } from "../theme/interface-size";
import { useTabs, type FolderTab, type FolderViewState } from "../store/tabs";
import { Breadcrumb } from "./Breadcrumb";
import { ConfirmBanner } from "./ConfirmBanner";
import { FileGrid } from "./FileGrid";
import { FileOpsUi } from "./FileOpsUi";
import { FileList } from "./FileList";
import { ROW_HEIGHT } from "./grid-layout";
import { useFolderUi, DEFAULT_SORT } from "./folder-ui";
import { registerFolder, type MoveTo } from "./folder-controller";
import { useFolderStatus } from "./folder-status";
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
import { loadViewSettings, useViewSettings, useViewSettingsSync } from "./view-settings";
import { useFolder } from "./useFolder";
import "../ops/ops.css";
import "./files.css";

// The right-click menu is the folder actions of the table, grouped as the
// main menu groups them (keyboard and right-click parity, design 4.5).
const CONTEXT_MENU: MenuSection[] = (["Open", "Edit", "Create", "Selection", "View"] as const).map(
  (area) => ({
    title: area,
    actions: actions.filter((a) => a.when === "folder" && a.area === area),
  })
);

function ErrorText(props: { error: WireError }) {
  return (
    <>
      {props.error.kind}: {props.error.message}
    </>
  );
}

// Design 4.1: the folder list beside the places, with the location above it.
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
  const { showHidden, viewMode, density, error: settingsError } = useViewSettings();
  const sort = useFolderUi((s) => s.sort[tab.id] ?? DEFAULT_SORT);
  const key = pathKey(tab.path);
  const isActive = useTabs((s) => s.activeId === tab.id);
  // What this tab's view kept when it was last unmounted (design 4.1). It is read once
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
  const [openErrors, setOpenErrors] = useState<WireError[]>([]);
  const [revealTick, setRevealTick] = useState(0);
  // What could not be selected, apart from the open errors, which are replaced by each open.
  const [selectNotes, setSelectNotes] = useState<WireError[]>([]);
  // Items another program asked to have selected here (kern://select), once listed.
  const selectRequest = useTabs((s) => s.selectRequests[tab.id]);
  useEffect(() => {
    if (!selectRequest || folder.phase !== "ready") return;
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
      setSelectNotes((notes) => [
        ...notes,
        {
          kind: "NotFound",
          message: `Not selected: ${missing.map(describe).join(", ")}`,
          path: null,
          details: null,
        },
      ]);
    }
  }, [selectRequest, folder.phase, entries, selectKeys, tab.id, showHidden]);
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

  const rowHeight = ROW_HEIGHT[density];
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

  // The controller reads the latest view state without being re-registered.
  const latest = useRef({ entries, sel, viewMode, columns, phase: folder.phase });
  useEffect(() => {
    latest.current = { entries, sel, viewMode, columns, phase: folder.phase };
  });
  // What the file operations act on: the selection, in list order, and nothing else. An item
  // that is only outlined (the cursor) is not selected and is never copied, cut, trashed,
  // deleted, renamed or dragged.
  const selected = useCallback(() => {
    const { entries: es, sel: s } = latest.current;
    return [...s.selected].sort((a, b) => a - b).flatMap((i) => (es[i] ? [es[i]] : []));
  }, []);
  // What Enter opens: the selection, or else the outlined item.
  const toOpen = useCallback(() => {
    const picked = selected();
    const { entries: es, sel: s } = latest.current;
    const outlined = s.cursor === null ? undefined : es[s.cursor];
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
  useEffect(() => {
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
    },
    [tab.id]
  );
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
    ready: () => latest.current.phase === "ready",
    relist,
    selectKeys,
    reveal: () => setRevealTick((t) => t + 1),
    focusList: () => keyboardTarget()?.focus(),
  });

  // Something dropped on a folder (a pointer drag inside Kern, or a drop from another
  // application): the modifier keys decide, and with none to go by the user is asked.
  const { askDrop, drop: dropItems, fail } = fileOps;
  const dropOn = useCallback(
    (sources: WirePath[], dest: WirePath, mods: DragModifiers | null) => {
      const choice = decideDrop(mods);
      if (choice === "ask") askDrop(sources, dest);
      else dropItems(choice, sources, dest);
    },
    [askDrop, dropItems]
  );
  const drag = useItemDrag({
    itemsFor: (index) => {
      const { entries: es, sel: s } = latest.current;
      if (s.selected.has(index)) return selected();
      const only = es[index];
      if (!only) return [];
      dispatch((x) => click(x, index));
      return [only];
    },
    onDrop: dropOn,
    onLeave: (sources) => {
      dragOut(sources).catch(fail);
    },
  });

  // A drop from another application lands where the pointer was.
  const interfaceSize = useViewSettings((s) => s.interfaceSize);
  const dropState = useRef({ isActive, path: tab.path, interfaceSize });
  useEffect(() => {
    dropState.current = { isActive, path: tab.path, interfaceSize };
  });
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    on(EVENT_DROP, (drop: DropPayload) => {
      const now = dropState.current;
      if (!now.isActive || drop.paths.length === 0) return;
      const at = toCssPoint(
        drop.position,
        window.devicePixelRatio || 1,
        zoomFactor(now.interfaceSize)
      );
      const hit = dropTargetAt(at.x, at.y);
      const dest = hit && canDropOn(drop.paths, hit.path) ? hit.path : now.path;
      dropOn(drop.paths, dest, null);
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
      selectAll: () => dispatch((s, n) => selectAll(s, n)),
      selectNone: () => dispatch((s) => selectNone(s)),
      hasSelection: () => latest.current.sel.selected.size > 0,
      canOpen: () => toOpen().length > 0,
      canMove: (to) =>
        latest.current.entries.length > 0 &&
        (latest.current.viewMode === "grid" || (to !== "left" && to !== "right")),
      move: (to, extend) => {
        dispatch((s, n) => move(s, step(to), extend, n));
        setRevealTick((t) => t + 1);
      },
      open: (newWindow) => openOrAsk(toOpen(), newWindow),
      refresh,
      editLocation: () => setEditing(true),
      ...fileOps.controller,
    });
  }, [tab.id, dispatch, openOrAsk, refresh, toOpen, fileOps.controller]);

  // The status bar's counts (design 4.1).
  useEffect(() => {
    if (folder.phase !== "ready") {
      useFolderStatus.getState().clear(tab.id);
      return;
    }
    let bytes = 0;
    let folders = 0;
    for (const i of sel.selected) {
      const e = entries[i];
      if (!e) continue;
      if (isFolder(e)) folders++;
      else bytes += e.len;
    }
    useFolderStatus.getState().set(tab.id, {
      items: entries.length,
      selected: sel.selected.size,
      selectedBytes: bytes,
      selectedFolders: folders,
    });
  }, [tab.id, folder.phase, entries, sel]);
  useEffect(() => () => useFolderStatus.getState().clear(tab.id), [tab.id]);

  const onItemClick = useCallback(
    (i: number, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) dispatch((s) => ctrlClick(s, i));
      else if (e.shiftKey) dispatch((s) => shiftClick(s, i));
      else dispatch((s) => click(s, i));
    },
    [dispatch]
  );
  // The keyboard goes back to the list once it has been navigated or re-sorted.
  useEffect(() => {
    if (!focusSoon.current || folder.phase === "loading") return;
    focusSoon.current = false;
    keyboardTarget()?.focus();
  });

  const onItemDoubleClick = useCallback(
    (i: number, e: React.MouseEvent) => {
      const entry = latest.current.entries[i];
      if (!entry) return;
      dispatch((s) => click(s, i));
      openOrAsk([entry], e.ctrlKey || e.metaKey);
    },
    [dispatch, openOrAsk]
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
          <div ref={note} tabIndex={-1} className="kern-note" data-testid="folder-empty">
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
            rowHeight={rowHeight}
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

  const viewButton = (id: string, Icon: typeof List, pressed: boolean) => {
    const action = getAction(id);
    return (
      <button
        type="button"
        className="kern-icon-button"
        aria-label={action.label}
        aria-pressed={pressed}
        title={`${action.label} (${action.keys[0]})`}
        onClick={() => {
          focusSoon.current = true;
          runAction(action, currentContext(tab.id));
        }}
      >
        <Icon size={20} strokeWidth={2} aria-hidden />
      </button>
    );
  };

  return (
    <div
      ref={files}
      className="kern-files"
      data-testid="folder-view"
      data-view={viewMode}
      onFocus={keep.onFocus}
      onBlur={keep.onBlur}
    >
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
        <div className="kern-view-toggle" role="group" aria-label="View">
          {viewButton("folder.view.list", List, viewMode === "list")}
          {viewButton("folder.view.grid", LayoutGrid, viewMode === "grid")}
        </div>
      </div>
      {settingsError && (
        <div role="alert" className="kern-banner">
          <span>
            Settings: <ErrorText error={settingsError} />
          </span>
        </div>
      )}
      {folder.sortError && (
        <div role="alert" className="kern-banner">
          <span>
            The list could not be sorted, so it is in the order the folder gave it. Choosing a sort
            tries again. <ErrorText error={folder.sortError} />
          </span>
        </div>
      )}
      {folder.watchError && (
        <div role="alert" className="kern-banner">
          <span>
            Changes to this folder will not appear by themselves (press F5 to refresh):{" "}
            <ErrorText error={folder.watchError} />
          </span>
        </div>
      )}
      {selectNotes.length > 0 && (
        <div role="alert" className="kern-banner">
          <ul>
            {selectNotes.map((e, i) => (
              <li key={i}>
                <ErrorText error={e} />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="kern-icon-button"
            aria-label="Dismiss"
            onClick={() => setSelectNotes([])}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
      {openErrors.length > 0 && (
        <div role="alert" className="kern-banner">
          <ul>
            {openErrors.map((e, i) => (
              <li key={i}>
                <ErrorText error={e} />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="kern-icon-button"
            aria-label="Dismiss"
            onClick={() => setOpenErrors([])}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
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
      <FileOpsUi ops={fileOps} scope={files} active={isActive} />
      {folder.phase === "ready" && folder.sorting && (
        <p role="status" className="kern-note-body">
          Sorting…
        </p>
      )}
      <div
        className="kern-files-body"
        onScrollCapture={onScrollCapture}
        onPointerDown={drag.onPointerDown}
      >
        {body}
      </div>
      <div ref={drag.ghost} className="kern-drag-ghost" aria-hidden hidden />
      {menu && (
        <ActionMenu
          sections={CONTEXT_MENU}
          x={menu.x}
          y={menu.y}
          targetId={tab.id}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
