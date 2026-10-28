// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Folder, Link2 } from "lucide-react";
import type { WireEntry } from "../ipc";
import type { Layout } from "./band";
import { fileType, isFolder } from "./file-type";
import { formatDate, formatSize } from "./format";
import type { Sel } from "./selection";
import type { SortBy, SortDir } from "./sort";
import { useRestoredScroll } from "./restore-scroll";
import { useRubberBand } from "./useRubberBand";
import { useCurrentItem } from "./use-current-item";

/** The column header's height. */
const HEADER_HEIGHT = 32;
/** Rows drawn beyond the visible ones on each side, so a fast scroll does not show blanks. */
const OVERSCAN = 12;

const COLUMNS: { by: SortBy; label: string }[] = [
  { by: "name", label: "Name" },
  { by: "type", label: "Type" },
  { by: "size", label: "Size" },
  { by: "modified", label: "Modified" },
];

export interface ItemsProps {
  entries: readonly WireEntry[];
  sel: Sel;
  onItemClick(i: number, e: React.MouseEvent): void;
  onItemDoubleClick(i: number, e: React.MouseEvent): void;
  /** `i` is null on the background. */
  onContextMenu(i: number | null, e: React.MouseEvent): void;
  onBand(indices: number[], additive: boolean, base: Sel): void;
  onBackgroundClick(): void;
}

export function FileBadge(props: { entry: WireEntry; size: number }) {
  const t = fileType(props.entry);
  const style = {
    width: props.size,
    height: props.size,
    ...(t.hue ? { color: `var(${t.hue})`, borderColor: `var(${t.hue})` } : {}),
  };
  if (t.id === "folder") {
    const Icon = props.entry.kind === "symlink" ? Link2 : Folder;
    return (
      <span className="kern-badge kern-badge-folder" style={style} aria-hidden>
        <Icon size={props.size * 0.6} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span className="kern-badge" style={style} aria-hidden>
      {t.mono}
    </span>
  );
}

export function FileList(
  props: ItemsProps & {
    rowHeight: number;
    sortBy: SortBy;
    sortDir: SortDir;
    /** True while the list is in the folder's own order because sorting failed: no header claims an order. */
    sortFailed?: boolean;
    onSort(by: SortBy): void;
    rootRef: React.RefObject<HTMLDivElement | null>;
    /** Counts keyboard moves of the cursor; each one scrolls the cursor into view. */
    revealTick: number;
    /** The offset a tab view kept, put back when the list mounts. */
    initialScroll: number;
  }
) {
  const { entries, sel, rowHeight } = props;
  const uid = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin: HEADER_HEIGHT,
    initialRect: { width: 600, height: 400 },
  });
  useRestoredScroll(scroller, props.initialScroll);

  // A keyboard move brings the cursor into view; a click or a relist does not.
  const cursor = useRef(sel.cursor);
  useEffect(() => {
    cursor.current = sel.cursor;
  });
  const { revealTick } = props;
  useEffect(() => {
    if (revealTick > 0 && cursor.current !== null) virtual.scrollToIndex(cursor.current);
  }, [revealTick, virtual]);

  const item = useCurrentItem(entries.length, sel.cursor);

  const layout: Layout = { kind: "list", rowHeight, count: entries.length };
  const { onPointerDown, band } = useRubberBand({
    scroller,
    inner,
    layout,
    sel,
    onBand: props.onBand,
    onBackgroundClick: props.onBackgroundClick,
  });

  return (
    <div
      ref={props.rootRef}
      role="grid"
      tabIndex={0}
      aria-label="Files"
      aria-multiselectable
      aria-rowcount={entries.length}
      aria-activedescendant={item.current === null ? undefined : `${uid}-row-${item.current}`}
      className="kern-list"
      data-testid="folder-list"
      {...item.handlers}
    >
      <div
        ref={scroller}
        className="kern-scroll"
        data-testid="folder-scroll"
        onPointerDown={onPointerDown}
        onContextMenu={(e) =>
          !(e.target as Element).closest("[data-item]") && props.onContextMenu(null, e)
        }
      >
        <div role="row" className="kern-list-head" style={{ height: HEADER_HEIGHT }}>
          {COLUMNS.map((c) => {
            const active = !props.sortFailed && props.sortBy === c.by;
            const Arrow = props.sortDir === "asc" ? ArrowUp : ArrowDown;
            return (
              <div
                key={c.by}
                role="columnheader"
                className={`kern-col kern-col-${c.by}`}
                aria-sort={active ? (props.sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" onClick={() => props.onSort(c.by)}>
                  {c.label}
                  {active && <Arrow size={12} strokeWidth={2.5} aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
        <div
          ref={inner}
          role="rowgroup"
          className="kern-list-body"
          style={{ height: virtual.getTotalSize() }}
        >
          {virtual.getVirtualItems().map((v) => {
            const e = entries[v.index];
            if (!e) return null;
            const t = fileType(e);
            const selected = sel.selected.has(v.index);
            return (
              <div
                key={v.key}
                id={`${uid}-row-${v.index}`}
                role="row"
                aria-rowindex={v.index + 1}
                aria-selected={selected}
                data-item
                data-testid="file-row"
                data-name={e.name}
                className={
                  "kern-row" +
                  (selected ? " kern-selected" : "") +
                  (item.outlined === v.index ? " kern-cursor" : "")
                }
                style={{
                  height: rowHeight,
                  transform: `translateY(${v.start - HEADER_HEIGHT}px)`,
                }}
                onClick={(ev) => props.onItemClick(v.index, ev)}
                onDoubleClick={(ev) => props.onItemDoubleClick(v.index, ev)}
                onContextMenu={(ev) => props.onContextMenu(v.index, ev)}
              >
                <div role="gridcell" className="kern-col kern-col-name">
                  <FileBadge entry={e} size={rowHeight - 12} />
                  <span className="kern-name" title={e.name}>
                    {e.name}
                  </span>
                </div>
                <div role="gridcell" className="kern-col kern-col-type">
                  {t.label}
                </div>
                <div role="gridcell" className="kern-col kern-col-size">
                  {isFolder(e) ? "" : formatSize(e.len)}
                </div>
                <div role="gridcell" className="kern-col kern-col-modified">
                  {formatDate(e.modified_ms)}
                </div>
              </div>
            );
          })}
          {band && (
            <div
              className="kern-band"
              style={{
                left: band.left,
                top: band.top,
                width: band.right - band.left,
                height: band.bottom - band.top,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
