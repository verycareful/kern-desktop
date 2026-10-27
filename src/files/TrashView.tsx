// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArchiveRestore, Folder, Trash2 } from "lucide-react";
import {
  displayPath,
  pathKey,
  startOp,
  toWireError,
  trashList,
  trashPurge,
  trashRestore,
  type OpProgressEvent,
  type WireError,
  type WireItemError,
  type WireReport,
  type WireTrashedItem,
} from "../ipc";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import { actions, currentContext, getAction, runAction } from "../keys/actions";
import { needsAttention, type Outcome } from "../ops/outcome";
import { ReportPanel } from "../ops/ReportPanel";
import { runOp, type RunningOp } from "../ops/run-op";
import type { TrashTab } from "../store/tabs";
import { ConfirmBanner } from "./ConfirmBanner";
import { deletedText } from "./trash-text";
import { useFolderStatus } from "./folder-status";
import { ROW_HEIGHT } from "./grid-layout";
import { registerTrash, type TrashMove } from "./trash-controller";
import {
  click,
  ctrlClick,
  empty,
  move,
  selectAll,
  selectNone,
  shiftClick,
  type Sel,
} from "./selection";
import { useViewSettings } from "./view-settings";
import "./files.css";

// Design 5.2: the Trash lists the home trash and the trashes of the mounted
// volumes with each item's original path and deletion time. Restore and
// Delete permanently act on the selected items; Empty Trash runs as the
// empty_trash operation, with progress. Deleting for good and emptying are
// confirmed, and say that they cannot be undone (5.7). Every item travels as
// the WireTrashedItem the listing gave, so a name that is not UTF-8 is acted
// on with its real bytes (Review Focus 1). Whatever fails is shown by a
// report panel (src/ops/ReportPanel.tsx).

const HEADER_HEIGHT = 32;
const OVERSCAN = 12;

const CONTEXT_MENU: MenuSection[] = (["Trash", "Selection"] as const).map((area) => ({
  title: area,
  actions: actions.filter((a) => a.when === "trash" && a.area === area),
}));

/** Newest deletion first; the DeletionDate is YYYY-MM-DDThh:mm:ss, which orders as text. */
function byNewest(a: WireTrashedItem, b: WireTrashedItem): number {
  return a.deleted < b.deleted ? 1 : a.deleted > b.deleted ? -1 : a.name < b.name ? -1 : 1;
}

/** The selection of `from` carried over to the items of `to`, by item id. */
function carry(sel: Sel, from: readonly WireTrashedItem[], to: readonly WireTrashedItem[]): Sel {
  if (sel.selected.size === 0 && sel.anchor === null && sel.cursor === null) return sel;
  const at = new Map(to.map((t, i) => [t.id, i]));
  const index = (i: number | null) => {
    const item = i === null ? undefined : from[i];
    return item === undefined ? null : (at.get(item.id) ?? null);
  };
  const selected = new Set<number>();
  for (const i of sel.selected) {
    const j = index(i);
    if (j !== null) selected.add(j);
  }
  return { selected, anchor: index(sel.anchor), cursor: index(sel.cursor) };
}

type Phase = "loading" | "ready" | "error";
type Working =
  | { what: "restore" | "purge" }
  | { what: "empty"; progress: OpProgressEvent | null; cancelling: boolean };

const plural = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "item" : "items"}`;

export function TrashView(props: { tab: TrashTab }) {
  const tabId = props.tab.id;
  const density = useViewSettings((s) => s.density);
  const rowHeight = ROW_HEIGHT[density];
  const uid = useId();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<WireError | null>(null);
  const [items, setItems] = useState<WireTrashedItem[]>([]);
  const [unreadable, setUnreadable] = useState<WireItemError[]>([]);
  const [sel, setSel] = useState<Sel>(empty);
  const [working, setWorking] = useState<Working | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [asking, setAsking] = useState<"purge" | "empty" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const files = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const running = useRef<RunningOp | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The controller and the handlers read the latest state without being re-registered.
  const latest = useRef({ items, sel, working });
  useEffect(() => {
    latest.current = { items, sel, working };
  });

  // Lists the trash. A slow answer to an older call never replaces a newer one.
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const listing = await trashList();
      if (!alive.current || mine !== seq.current) return;
      const next = [...listing.items].sort(byNewest);
      setSel((s) => carry(s, latest.current.items, next));
      latest.current.items = next;
      setItems(next);
      setUnreadable(listing.unreadable);
      setLoadError(null);
      setPhase("ready");
    } catch (e) {
      if (!alive.current || mine !== seq.current) return;
      setLoadError(toWireError(e));
      setPhase("error");
    }
  }, []);
  useEffect(() => {
    void refresh();
    // What was trashed elsewhere while another window had the focus shows up on return.
    const onFocus = () => {
      if (latest.current.working === null) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const report = (o: Outcome) => {
    if (alive.current && needsAttention(o)) setOutcomes((list) => [...list, o]);
  };

  const selected = () => {
    const { items: all, sel: s } = latest.current;
    return [...s.selected].sort((a, b) => a - b).flatMap((i) => (all[i] ? [all[i]] : []));
  };

  // Restore and Delete permanently: one command, one report; a refusal of the
  // command itself is reported like an item that failed.
  const act = useCallback(
    async (
      what: "restore" | "purge",
      title: string,
      call: (list: WireTrashedItem[]) => Promise<WireReport>
    ) => {
      const list = selected();
      if (list.length === 0 || latest.current.working) return;
      latest.current.working = { what };
      setWorking({ what });
      let outcome: Outcome;
      try {
        outcome = { title, report: await call(list), error: null };
      } catch (e) {
        outcome = { title, report: null, error: toWireError(e) };
      }
      latest.current.working = null;
      if (alive.current) setWorking(null);
      report(outcome);
      // The items that went are not listed any more, and what stayed still is.
      await refresh();
    },
    [refresh]
  );

  const emptyTrash = useCallback(async () => {
    if (latest.current.working) return;
    const state: Working = { what: "empty", progress: null, cancelling: false };
    latest.current.working = state;
    setWorking(state);
    const title = "Empty Trash";
    let outcome: Outcome;
    try {
      const op = runOp(
        () => startOp("empty_trash", []),
        (progress) => alive.current && setWorking({ what: "empty", progress, cancelling: false })
      );
      running.current = op;
      const end = await op.done;
      outcome = { title, report: end.report, error: end.error };
    } catch (e) {
      outcome = { title, report: null, error: toWireError(e) };
    }
    running.current = null;
    latest.current.working = null;
    if (alive.current) setWorking(null);
    report(outcome);
    await refresh();
  }, [refresh]);

  const cancelEmpty = () => {
    const op = running.current;
    if (!op) return;
    setWorking((w) => (w?.what === "empty" ? { ...w, cancelling: true } : w));
    op.cancel().catch((e: unknown) =>
      report({ title: "Empty Trash", report: null, error: toWireError(e) })
    );
  };

  const dispatch = useCallback((op: (s: Sel, n: number) => Sel) => {
    setSel((s) => op(s, latest.current.items.length));
  }, []);

  useEffect(() => {
    const step = (to: TrashMove): number =>
      ({ up: -1, down: 1, first: -Infinity, last: Infinity })[to];
    return registerTrash(tabId, {
      selectAll: () => dispatch((s, n) => selectAll(s, n)),
      selectNone: () => dispatch((s) => selectNone(s)),
      hasSelection: () => latest.current.sel.selected.size > 0,
      canMove: () => latest.current.items.length > 0,
      move: (to, extend) => {
        dispatch((s, n) => move(s, step(to), extend, n));
        setRevealTick((t) => t + 1);
      },
      canAct: (needsSelection) =>
        latest.current.working === null &&
        (needsSelection ? latest.current.sel.selected.size > 0 : latest.current.items.length > 0),
      restore: () => void act("restore", "Restore from Trash", trashRestore),
      askPurge: () => latest.current.sel.selected.size > 0 && setAsking("purge"),
      askEmpty: () => latest.current.items.length > 0 && setAsking("empty"),
      refresh: () => void refresh(),
    });
  }, [tabId, dispatch, act, refresh]);

  // The status bar's counts (design 4.1).
  useEffect(() => {
    useFolderStatus.getState().set(tabId, {
      items: items.length,
      selected: sel.selected.size,
      selectedBytes: 0,
      selectedFolders: 0,
    });
  }, [tabId, items, sel]);
  useEffect(() => () => useFolderStatus.getState().clear(tabId), [tabId]);

  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin: HEADER_HEIGHT,
    initialRect: { width: 600, height: 400 },
  });
  const cursor = useRef(sel.cursor);
  useEffect(() => {
    cursor.current = sel.cursor;
  });
  useEffect(() => {
    if (revealTick > 0 && cursor.current !== null) virtual.scrollToIndex(cursor.current);
  }, [revealTick, virtual]);

  // The buttons run the same actions as the keys and the menu; whether they can
  // is worked out from this render's state, which the controller sees one effect later.
  const idle = working === null;
  const button = (id: string, Icon: typeof Folder, enabled: boolean) => {
    const action = getAction(id);
    return (
      <button
        type="button"
        className="kern-button kern-trash-button"
        disabled={!enabled}
        title={action.keys[0] ? `${action.label} (${action.keys[0]})` : action.label}
        onClick={() => runAction(action, currentContext(tabId))}
      >
        <Icon size={16} strokeWidth={2} aria-hidden />
        {action.label}
      </button>
    );
  };

  const asked = asking === "purge" ? selected() : items;
  const askMessage =
    asking === "purge"
      ? `Delete ${asked.length === 1 ? (asked[0]?.name ?? "") : plural(asked.length)} for good? ` +
        "It cannot be undone."
      : `Delete all ${plural(items.length)} in the Trash for good? This cannot be undone.`;

  let body;
  if (phase === "loading") {
    body = (
      <p role="status" className="kern-note-body">
        Loading…
      </p>
    );
  } else if (phase === "error") {
    body = (
      <div role="alert" className="kern-banner">
        <span>
          The Trash could not be read: {loadError?.kind}: {loadError?.message}
        </span>
        <button type="button" className="kern-button" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="kern-note" data-testid="trash-empty">
        <Trash2 size={30} strokeWidth={1.8} aria-hidden />
        <p className="kern-note-title">The Trash is empty</p>
      </div>
    );
  } else {
    body = (
      <div
        ref={root}
        role="grid"
        tabIndex={0}
        aria-label="Trash"
        aria-multiselectable
        aria-rowcount={items.length}
        aria-activedescendant={sel.cursor === null ? undefined : `${uid}-row-${sel.cursor}`}
        className="kern-list"
        data-testid="trash-list"
      >
        <div
          ref={scroller}
          className="kern-scroll"
          onClick={(e) => {
            if (!(e.target as Element).closest("[data-item]")) dispatch((s) => selectNone(s));
          }}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("[data-item]")) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div role="row" className="kern-list-head" style={{ height: HEADER_HEIGHT }}>
            <div role="columnheader" className="kern-col kern-col-name">
              Name
            </div>
            <div role="columnheader" className="kern-col kern-col-original">
              Original location
            </div>
            <div role="columnheader" className="kern-col kern-col-deleted">
              Deleted
            </div>
          </div>
          <div
            role="rowgroup"
            className="kern-list-body"
            style={{ height: virtual.getTotalSize() }}
          >
            {virtual.getVirtualItems().map((v) => {
              const item = items[v.index];
              if (!item) return null;
              const isSelected = sel.selected.has(v.index);
              return (
                <div
                  key={item.id}
                  id={`${uid}-row-${v.index}`}
                  role="row"
                  aria-rowindex={v.index + 1}
                  aria-selected={isSelected}
                  data-item
                  data-testid="trash-row"
                  className={
                    "kern-row" +
                    (isSelected ? " kern-selected" : "") +
                    (sel.cursor === v.index ? " kern-cursor" : "")
                  }
                  style={{
                    height: rowHeight,
                    transform: `translateY(${v.start - HEADER_HEIGHT}px)`,
                  }}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) dispatch((s) => ctrlClick(s, v.index));
                    else if (e.shiftKey) dispatch((s) => shiftClick(s, v.index));
                    else dispatch((s) => click(s, v.index));
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!latest.current.sel.selected.has(v.index))
                      dispatch((s) => click(s, v.index));
                    setMenu({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <div role="gridcell" className="kern-col kern-col-name">
                    {item.is_dir && <Folder size={16} strokeWidth={2} aria-hidden />}
                    <span className="kern-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div
                    role="gridcell"
                    className="kern-col kern-col-original"
                    title={displayPath(item.original)}
                  >
                    {displayPath(item.original)}
                  </div>
                  <div role="gridcell" className="kern-col kern-col-deleted">
                    {deletedText(item.deleted)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const progress = working?.what === "empty" ? working : null;
  return (
    <div ref={files} className="kern-files kern-trash" data-testid="trash-view">
      <div className="kern-files-bar">
        <h2 className="kern-trash-title">Trash</h2>
        <div className="kern-trash-actions" role="group" aria-label="Trash actions">
          {button("trash.restore", ArchiveRestore, idle && sel.selected.size > 0)}
          {button("trash.purge", Trash2, idle && sel.selected.size > 0)}
          {button("trash.empty", Trash2, idle && items.length > 0)}
        </div>
      </div>
      {unreadable.length > 0 && (
        <div role="alert" className="kern-banner">
          <div>
            <p>Some items in the Trash could not be read, so they are not listed:</p>
            <ul>
              {unreadable.map((u, i) => (
                <li key={`${pathKey(u.path)}:${i}`}>
                  {displayPath(u.path)}: {u.error.kind}: {u.error.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {outcomes.map((o, i) => (
        <ReportPanel
          key={i}
          outcome={o}
          onDismiss={() => setOutcomes((list) => list.filter((_, j) => j !== i))}
        />
      ))}
      {working && working.what !== "empty" && (
        <p role="status" className="kern-note-body">
          {working.what === "restore" ? "Restoring…" : "Deleting…"}
        </p>
      )}
      {progress && (
        <div className="kern-banner kern-trash-progress">
          <span>{progress.cancelling ? "Cancelling…" : "Emptying the Trash…"}</span>
          <div
            role="progressbar"
            aria-label="Emptying the Trash"
            aria-valuemin={0}
            aria-valuemax={progress.progress?.total}
            aria-valuenow={progress.progress?.done}
            className="kern-progress"
          >
            <div
              className="kern-progress-bar"
              style={{
                width: progress.progress
                  ? `${(100 * progress.progress.done) / Math.max(1, progress.progress.total)}%`
                  : "0%",
              }}
            />
          </div>
          <button
            type="button"
            className="kern-button"
            disabled={progress.cancelling}
            onClick={cancelEmpty}
          >
            Cancel
          </button>
        </div>
      )}
      {asking && (
        <ConfirmBanner
          label={asking === "purge" ? "Delete permanently" : "Empty the Trash"}
          message={askMessage}
          confirmLabel={asking === "purge" ? `Delete ${plural(asked.length)}` : "Empty the Trash"}
          scope={files}
          onConfirm={() => {
            const which = asking;
            setAsking(null);
            if (which === "purge") void act("purge", "Delete permanently", trashPurge);
            else void emptyTrash();
          }}
          onCancel={() => {
            setAsking(null);
            root.current?.focus();
          }}
        />
      )}
      <div className="kern-files-body">{body}</div>
      {menu && (
        <ActionMenu
          sections={CONTEXT_MENU}
          x={menu.x}
          y={menu.y}
          targetId={tabId}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
