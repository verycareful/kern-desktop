// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Repeat, X } from "lucide-react";
import { displayPath, toWireError, type WireEntry, type WirePath } from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { openFiles } from "./open-entries";
import {
  INDENT,
  ROW_HEIGHT,
  TYPE_AHEAD_MS,
  indexByKey,
  treeKey,
  type EntryRow,
  type Row,
} from "./tree";
import { useTree } from "./useTree";

// The folder tree of the editor layout (design D4.1 to D4.3): the window's folder at the
// top, its entries below, a folder opening in place when it is clicked or opened with the keyboard
// and a file opening as D4.3 says (text as a tab, any other file in its default application). Only
// the rows in view exist in the page, so a folder of 100 000 entries scrolls like a small one.
// It is a WAI-ARIA tree (tree.ts lists the keys); keyboard focus shows on the current row only,
// as in the folder view.

/** Rows drawn beyond the visible ones on each side, so a fast scroll does not show blanks. */
const OVERSCAN = 12;

/** Whether `key` is `ancestor` or lies below it, following the rows' folder keys. */
function insideRow(rows: readonly Row[], at: Map<string, number>, key: string, ancestor: string) {
  for (let k: string | undefined = key; k !== undefined;) {
    if (k === ancestor) return true;
    const i = at.get(k);
    const r = i === undefined ? undefined : rows[i];
    k = r?.kind === "entry" ? r.parentKey : undefined;
  }
  return false;
}

export function FolderTree(props: {
  root: WirePath;
  /** Whether hidden items are listed. */
  hidden: boolean;
  treeId?: string;
  /** The root is gone; `nearest` is the closest folder above it that lists (see useTree). */
  onRootGone?(nearest: WirePath | null): void;
  /** A right-click or the Menu key on an entry, or on the empty part (null), at a point. */
  onContextMenu?(entry: WireEntry | null, x: number, y: number): void;
}) {
  const { root } = props;
  const uid = useId();
  const tree = useTree({
    root,
    hidden: props.hidden,
    treeId: props.treeId,
    onRootGone: props.onRootGone,
  });
  const { rows } = tree;
  const at = useMemo(() => indexByKey(rows), [rows]);
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const activeIndex = active !== null ? (at.get(active) ?? -1) : -1;

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: { width: 300, height: 600 },
  });

  // A row that went (its folder closed or vanished) leaves the current row at the folder it was in.
  const folderOfActive = useRef<string | null>(null);
  useEffect(() => {
    if (active === null) {
      folderOfActive.current = null;
      return;
    }
    const i = at.get(active);
    const row = i === undefined ? undefined : rows[i];
    if (row?.kind === "entry") {
      folderOfActive.current = row.parentKey;
      return;
    }
    const folder = folderOfActive.current;
    setActive(folder !== null && at.has(folder) ? folder : null);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = useCallback(
    (entry: WireEntry) => {
      openFiles([entry.path], false).then(
        (errors) => errors.forEach((e) => tree.notify(`${baseName(entry.path)}: ${errorText(e)}`)),
        (e: unknown) => tree.notify(`${baseName(entry.path)}: ${errorText(toWireError(e))}`)
      );
    },
    [tree]
  );

  const toggle = useCallback(
    (row: EntryRow) => {
      if (row.loop || !row.folder) return;
      if (row.expanded) {
        // The current row inside the folder being closed goes to the folder itself.
        if (active !== null && insideRow(rows, at, active, row.key) && active !== row.key) {
          setActive(row.key);
        }
        tree.collapse(row.key);
      } else tree.expand(row.entry, row.parentKey);
    },
    [tree, rows, at, active]
  );

  const activate = (row: EntryRow) => {
    if (row.folder) toggle(row);
    else openFile(row.entry);
  };

  const moveTo = (i: number) => {
    const r = rows[i];
    if (r?.kind !== "entry") return;
    setActive(r.key);
    virtual.scrollToIndex(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const row = rows[activeIndex];
      const box = scroller.current?.querySelector(`[data-active="true"]`)?.getBoundingClientRect();
      if (props.onContextMenu && row?.kind === "entry") {
        e.preventDefault();
        props.onContextMenu(row.entry, box?.left ?? 0, box?.bottom ?? 0);
      }
      return;
    }
    // Characters typed within a second of each other make one word for the type-ahead.
    const now = Date.now();
    let text = "";
    const isChar = e.key.length === 1;
    const continuing = typed.current.text !== "" && now - typed.current.at < TYPE_AHEAD_MS;
    if (isChar && (e.key !== " " || continuing)) {
      text = (continuing ? typed.current.text : "") + e.key;
      typed.current = { text, at: now };
    }
    const action = treeKey(rows, activeIndex, text !== "" ? text : e.key, text);
    if (!action) return;
    e.preventDefault();
    if ("move" in action) moveTo(action.move);
    else if ("expand" in action || "collapse" in action) {
      const key = "expand" in action ? action.expand : action.collapse;
      const row = rows[at.get(key) ?? -1];
      if (row?.kind === "entry") toggle(row);
    } else {
      const row = rows[at.get(action.activate) ?? -1];
      if (row?.kind === "entry") activate(row);
    }
  };

  const onRowClick = (row: EntryRow) => {
    setActive(row.key);
    scroller.current?.focus();
    activate(row);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!props.onContextMenu) return;
    e.preventDefault();
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-row-index]");
    const row = rowEl ? rows[Number(rowEl.dataset.rowIndex)] : undefined;
    if (row?.kind === "entry") {
      setActive(row.key);
      props.onContextMenu(row.entry, e.clientX, e.clientY);
    } else props.onContextMenu(null, e.clientX, e.clientY);
  };

  const rowId = (i: number) => `${uid}-row-${i}`;
  return (
    <div className="kern-tree-wrap" data-testid="folder-tree">
      <div className="kern-tree-head" title={displayPath(root)}>
        <FolderOpen size={16} strokeWidth={2} aria-hidden />
        <span className="kern-tree-head-name">{baseName(root)}</span>
      </div>
      {tree.notes.length > 0 && (
        <ul className="kern-tree-notes" role="status" aria-label="Notes about the folder tree">
          {tree.notes.map((n) => (
            <li key={n.id}>
              <span>{n.text}</span>
              <button
                type="button"
                className="kern-icon-button"
                aria-label="Dismiss"
                onClick={() => tree.dismissNote(n.id)}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        ref={scroller}
        className="kern-tree"
        role="tree"
        aria-label={`Folders of ${baseName(root)}`}
        tabIndex={0}
        aria-activedescendant={activeIndex >= 0 ? rowId(activeIndex) : undefined}
        data-testid="tree-scroll"
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onContextMenu={onContextMenu}
      >
        <div className="kern-tree-body" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            const style = {
              height: ROW_HEIGHT,
              transform: `translateY(${v.start}px)`,
              paddingLeft: 6 + row.depth * INDENT,
            };
            if (row.kind === "note") {
              return (
                <div
                  key={row.key}
                  role="presentation"
                  className={`kern-tree-row kern-tree-note kern-tree-note-${row.tone}`}
                  style={style}
                  data-testid="tree-note"
                  data-row-index={v.index}
                >
                  <span>{row.text}</span>
                </div>
              );
            }
            const isActive = row.key === active;
            const Icon = row.loop ? Repeat : row.folder ? Folder : File;
            return (
              <div
                key={row.key}
                id={rowId(v.index)}
                role="treeitem"
                className={
                  "kern-tree-row" +
                  (isActive ? " kern-selected" : "") +
                  (isActive && focused ? " kern-cursor" : "")
                }
                style={style}
                aria-level={row.depth + 1}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-expanded={row.folder && !row.loop ? row.expanded : undefined}
                aria-selected={isActive}
                data-testid="tree-row"
                data-name={row.entry.name}
                data-row-index={v.index}
                data-active={isActive ? "true" : undefined}
                title={displayPath(row.entry.path)}
                onClick={() => onRowClick(row)}
              >
                <span className="kern-tree-twist" aria-hidden>
                  {row.folder && !row.loop ? (
                    row.expanded ? (
                      <ChevronDown size={14} strokeWidth={2} />
                    ) : (
                      <ChevronRight size={14} strokeWidth={2} />
                    )
                  ) : null}
                </span>
                <Icon size={16} strokeWidth={2} aria-hidden />
                <span className="kern-tree-name">{row.entry.name}</span>
                {row.loop && (
                  <span className="kern-tree-flag">
                    leads back to a folder above it, not opened
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
