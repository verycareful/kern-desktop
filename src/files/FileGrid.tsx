// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Folder, Link2 } from "lucide-react";
import type { WireEntry } from "../ipc";
import { pathKey } from "../ipc";
import type { Layout } from "./band";
import { fileType, isFolder } from "./file-type";
import { formatDate, formatSize } from "./format";
import type { ItemsProps } from "./FileList";
import { CARD, columnsFor } from "./grid-layout";
import { thumbSizeFor, useThumbnails, type ThumbState } from "./useThumbnails";
import { useRestoredScroll } from "./restore-scroll";
import { useRubberBand } from "./useRubberBand";
import { useCurrentItem } from "./use-current-item";
import { useViewSettings } from "./view-settings";
import { zoomFactor } from "../theme/interface-size";

const ROW_PITCH = CARD.height + CARD.gap;
const OVERSCAN = 3;
let mounts = 0;

export function FileGrid(
  props: ItemsProps & {
    /** The key the backend knows this view's thumbnails by. */
    thumbKey: string;
    onColumns(n: number): void;
    rootRef: React.RefObject<HTMLDivElement | null>;
    /** Counts keyboard moves of the cursor; each one scrolls the cursor into view. */
    revealTick: number;
    /** The offset a tab view kept, put back when the grid mounts. */
    initialScroll: number;
  }
) {
  const { entries, sel } = props;
  const uid = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [measured, setMeasured] = useState(false);
  const columns = columnsFor(width);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setWidth(el.clientWidth || el.getBoundingClientRect().width || 800);
    setMeasured(true);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useRestoredScroll(scroller, props.initialScroll, measured);

  const { onColumns } = props;
  useEffect(() => onColumns(columns), [columns, onColumns]);

  const rows = Math.ceil(entries.length / columns);
  const virtual = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PITCH,
    overscan: OVERSCAN,
    initialRect: { width: 600, height: 400 },
  });
  const items = virtual.getVirtualItems();

  // A keyboard move brings the cursor into view; a click or a relist does not.
  const cursor = useRef(sel.cursor);
  const wide = useRef(columns);
  useEffect(() => {
    cursor.current = sel.cursor;
    wide.current = columns;
  });
  const { revealTick } = props;
  useEffect(() => {
    if (revealTick > 0 && cursor.current !== null) {
      virtual.scrollToIndex(Math.floor(cursor.current / wide.current));
    }
  }, [revealTick, virtual]);

  // Thumbnails are requested for the rows on screen. The rows drawn beyond
  // them (overscan) only keep a fast scroll from showing blanks; a thumbnail
  // for them would be work for images the user may never reach.
  const first = virtual.range?.startIndex ?? 0;
  const last = virtual.range?.endIndex ?? -1;
  const visible = useMemo(
    () => entries.slice(first * columns, (last + 1) * columns),
    [entries, first, last, columns]
  );
  // One key per mount: the cancel of a view that has gone must not reach the
  // queue of the view that replaced it.
  const mount = useRef(0);
  if (mount.current === 0) mount.current = ++mounts;
  const zoom = zoomFactor(useViewSettings((s) => s.interfaceSize));
  const thumbs = useThumbnails(
    `${props.thumbKey}:${mount.current}`,
    visible,
    thumbSizeFor(window.devicePixelRatio || 1, zoom)
  );

  const item = useCurrentItem(entries.length, sel.cursor);

  const layout: Layout = {
    kind: "grid",
    count: entries.length,
    columns,
    cardWidth: CARD.width,
    cardHeight: CARD.height,
    gap: CARD.gap,
    padding: CARD.padding,
    rowHeight: ROW_PITCH,
  };
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
      role="listbox"
      tabIndex={0}
      aria-label="Files"
      aria-multiselectable
      aria-activedescendant={item.current === null ? undefined : `${uid}-card-${item.current}`}
      className="kern-grid"
      data-testid="folder-grid"
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
        <div ref={inner} className="kern-grid-body" style={{ height: virtual.getTotalSize() }}>
          {items.map((row) => (
            <div
              key={row.key}
              role="presentation"
              className="kern-grid-row"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {Array.from({ length: columns }, (_, c) => {
                const i = row.index * columns + c;
                const e = entries[i];
                if (!e) return null;
                const selected = sel.selected.has(i);
                return (
                  <div
                    key={pathKey(e.path)}
                    id={`${uid}-card-${i}`}
                    role="option"
                    aria-selected={selected}
                    data-item
                    data-testid="file-card"
                    data-name={e.name}
                    className={
                      "kern-card" +
                      (selected ? " kern-selected" : "") +
                      (item.outlined === i ? " kern-cursor" : "")
                    }
                    style={{ width: CARD.width, height: CARD.height }}
                    onClick={(ev) => props.onItemClick(i, ev)}
                    onDoubleClick={(ev) => props.onItemDoubleClick(i, ev)}
                    onContextMenu={(ev) => props.onContextMenu(i, ev)}
                  >
                    <CardPicture entry={e} thumb={thumbs.get(pathKey(e.path))} />
                    <div className="kern-card-text">
                      <div className="kern-name" title={e.name}>
                        {e.name}
                      </div>
                      <div className="kern-card-meta">
                        {[isFolder(e) ? null : formatSize(e.len), formatDate(e.modified_ms)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
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

function CardPicture(props: { entry: WireEntry; thumb: ThumbState | undefined }) {
  const { entry, thumb } = props;
  const t = fileType(entry);
  const hue = t.hue ? `var(${t.hue})` : "var(--kern-text-dim)";
  if (thumb?.state === "ready") {
    return (
      <div className="kern-card-pic">
        <img src={thumb.url} alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div
      className="kern-card-pic kern-card-wash"
      style={{ color: hue }}
      title={thumb?.state === "error" ? `${thumb.error.kind}: ${thumb.error.message}` : undefined}
    >
      {t.id === "folder" ? (
        entry.kind === "symlink" ? (
          <Link2 size={36} strokeWidth={1.8} aria-hidden />
        ) : (
          <Folder size={36} strokeWidth={1.8} aria-hidden />
        )
      ) : (
        <span className="kern-card-mono">{t.mono}</span>
      )}
    </div>
  );
}
