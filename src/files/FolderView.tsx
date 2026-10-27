// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, LayoutGrid, List, X } from "lucide-react";
import { displayPath, pathKey, toWireError, type WireError, type WirePath } from "../ipc";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import { actions, currentContext, getAction, runAction } from "../keys/actions";
import { useTabs, type FolderTab, type FolderViewState } from "../store/tabs";
import { Breadcrumb } from "./Breadcrumb";
import { FileGrid } from "./FileGrid";
import { FileList } from "./FileList";
import { ROW_HEIGHT } from "./grid-layout";
import { useFolderUi, DEFAULT_SORT } from "./folder-ui";
import { registerFolder, type MoveTo } from "./folder-controller";
import { useFolderStatus } from "./folder-status";
import { GoneBanner } from "./GoneBanner";
import { LocationBar } from "./LocationBar";
import { OPEN_CONFIRM_ABOVE, openEntries } from "./open-entries";
import {
  click,
  ctrlClick,
  move,
  rubberBand,
  selectAll,
  selectNone,
  shiftClick,
  type Sel,
} from "./selection";
import { isFolder } from "./file-type";
import { loadViewSettings, useViewSettings, useViewSettingsSync } from "./view-settings";
import { useFolder } from "./useFolder";
import "./files.css";

// The right-click menu is the folder actions of the table, grouped as the
// main menu groups them (keyboard and right-click parity, design 4.5).
const CONTEXT_MENU: MenuSection[] = (["Open", "Selection", "View"] as const).map((area) => ({
  title: area,
  actions: actions.filter((a) => a.when === "folder" && a.area === area),
}));

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
  // What this tab's view kept when it was last unmounted (R56). It is read once
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
  const { entries, sel, dispatch, refresh } = folder;
  // Used up by the first listing (the list takes its scroll offset as it mounts)
  // or by a move to another folder, whichever comes first.
  useEffect(() => {
    if (kept && (folder.phase === "ready" || kept.pathKey !== key)) setKept(null);
  }, [kept, key, folder.phase]);
  const [editing, setEditing] = useState(keptHere?.location != null);
  const [openErrors, setOpenErrors] = useState<WireError[]>([]);
  const [revealTick, setRevealTick] = useState(0);
  // Items another program asked to have selected here (kern://select, R57), once listed.
  const selectRequest = useTabs((s) => s.selectRequests[tab.id]);
  const { selectKeys } = folder;
  useEffect(() => {
    if (!selectRequest || folder.phase !== "ready") return;
    useTabs.getState().clearSelectRequest(tab.id);
    const listed = new Set(entries.map((e) => pathKey(e.path)));
    const wanted = selectRequest.filter((p) => listed.has(pathKey(p)));
    selectKeys(wanted.map(pathKey));
    setRevealTick((n) => n + 1);
    const missing = selectRequest.filter((p) => !listed.has(pathKey(p)));
    if (missing.length > 0) {
      setOpenErrors((errs) => [
        ...errs,
        {
          kind: "NotFound",
          message: `Not in this folder, so not selected: ${missing.map(displayPath).join(", ")}`,
          path: null,
          details: null,
        },
      ]);
    }
  }, [selectRequest, folder.phase, entries, selectKeys, tab.id]);
  // What the location bar was reopened with, and the text typed in it since (kept for the view state).
  const [resumeText, setResumeText] = useState(keptHere?.location?.text);
  const locationText = useRef<string | undefined>(resumeText);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [columns, setColumns] = useState(1);
  const root = useRef<HTMLDivElement>(null);
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
  // Navigates this view's own tab, which is not the active one when the panel is slid in over a document.
  const navigate = useCallback(
    (p: WirePath) => {
      focusSoon.current = true;
      useTabs.getState().navigateTab(tab.id, p);
    },
    [tab.id]
  );

  // The controller reads the latest view state without being re-registered.
  const latest = useRef({ entries, sel, viewMode, columns });
  useEffect(() => {
    latest.current = { entries, sel, viewMode, columns };
  });

  // The view state is saved as the view unmounts (a tab switch, or the
  // folder panel folding away), from refs because the DOM is gone by then.
  const scrollTop = useRef(keptHere?.scrollTop ?? 0);
  const onScrollCapture = useCallback((e: React.UIEvent) => {
    if ((e.target as Element).classList.contains("kern-scroll")) {
      scrollTop.current = (e.target as Element).scrollTop;
    }
  }, []);
  // Reset with the folder: a new folder starts at the top.
  useEffect(() => {
    if (kept === null || kept.pathKey !== key) scrollTop.current = 0;
  }, [kept, key]);
  const ending = useRef({ phase: folder.phase, editing, key, path: tab.path });
  useEffect(() => {
    ending.current = { phase: folder.phase, editing, key, path: tab.path };
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
        location: end.editing ? { text: locationText.current ?? displayPath(end.path) } : null,
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

  useEffect(() => {
    const selected = () => {
      const { entries: es, sel: s } = latest.current;
      return [...s.selected].sort((a, b) => a - b).flatMap((i) => (es[i] ? [es[i]] : []));
    };
    const step = (to: MoveTo): number => {
      const { viewMode: mode, columns: cols } = latest.current;
      const row = mode === "grid" ? cols : 1;
      return { up: -row, down: row, left: -1, right: 1, first: -Infinity, last: Infinity }[to];
    };
    return registerFolder(tab.id, {
      selectAll: () => dispatch((s, n) => selectAll(s, n)),
      selectNone: () => dispatch((s) => selectNone(s)),
      hasSelection: () => latest.current.sel.selected.size > 0,
      canMove: (to) =>
        latest.current.entries.length > 0 &&
        (latest.current.viewMode === "grid" || (to !== "left" && to !== "right")),
      move: (to, extend) => {
        dispatch((s, n) => move(s, step(to), extend, n));
        setRevealTick((t) => t + 1);
      },
      open: (newWindow) => openOrAsk(selected(), newWindow),
      refresh,
      editLocation: () => setEditing(true),
    });
  }, [tab.id, dispatch, openOrAsk, refresh]);

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
    root.current?.focus();
  });

  // While the question is open it owns the keyboard: Escape answers no, Tab, Enter
  // and Space reach its buttons, and every other key is held back from the
  // shortcuts behind it (capture phase, before useShortcuts sees the event).
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        focusSoon.current = true;
        setAsking(null);
        return;
      }
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
      if (plain && ["Tab", "Enter", " "].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking]);

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
          <div className="kern-note" data-testid="folder-empty">
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
    <div className="kern-files" data-testid="folder-view" data-view={viewMode}>
      <div className="kern-files-bar">
        {editing ? (
          <LocationBar
            path={tab.path}
            initialText={resumeText}
            onText={(text) => (locationText.current = text)}
            onNavigate={navigate}
            onClose={() => {
              setEditing(false);
              setResumeText(undefined);
              locationText.current = undefined;
              root.current?.focus();
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
        <div role="alertdialog" aria-label="Open many items" className="kern-banner">
          <span>
            Open {asking.list.length} items at once? Each opens a tab, a window or an application.
          </span>
          <span>
            <button
              type="button"
              className="kern-button"
              onClick={() => {
                const { list, newWindow } = asking;
                setAsking(null);
                void open(list, newWindow);
              }}
            >
              Open {asking.list.length} items
            </button>{" "}
            <button
              type="button"
              className="kern-button"
              autoFocus
              onClick={() => {
                focusSoon.current = true;
                setAsking(null);
              }}
            >
              Cancel
            </button>
          </span>
        </div>
      )}
      {folder.phase === "ready" && folder.sorting && (
        <p role="status" className="kern-note-body">
          Sorting…
        </p>
      )}
      <div className="kern-files-body" onScrollCapture={onScrollCapture}>
        {body}
      </div>
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
