// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { displayPath, parent, pathKey, type WireEntry, type WirePath } from "../ipc";
import { errorText } from "../ops/error-text";
import { RepeatFlash } from "../ops/repeat-flash";
import { homeRelative } from "../shell/home-relative";
import { fileType, isFolder } from "./file-type";
import { FileBadge } from "./FileList";
import { formatDate, formatSize } from "./format";
import { LIST_HEADER_HEIGHT, ROW_HEIGHT } from "./grid-layout";
import { useScanSort, useSortedHits } from "./scan-sort";
import type { SortBy } from "./sort";
import { useSingleClick, useViewSettings, type ClickArea } from "./view-settings";

// The hits of a search or of the Library, as they stream in, virtualized, since a walk may find
// many thousands. One row is active: the arrow keys, Home and End move it, Enter opens it
// (Ctrl+Enter in a window of its own), and a double-click opens the row under the pointer.
//
// In the centre of the window a row is a file manager row (name, type, size, modified) plus the
// folder it is in, under a header whose columns sort the hits once the walk has ended. In the
// narrow editor column a row is the name over the folder and the time, with no header.

/** Rows drawn beyond the visible ones, so a fast scroll does not show gaps. */
const OVERSCAN = 8;

const COLUMNS: { by: SortBy; label: string }[] = [
  { by: "name", label: "Name" },
  { by: "type", label: "Type" },
  { by: "size", label: "Size" },
  { by: "modified", label: "Modified" },
  { by: "location", label: "Location" },
];

export function ScanResults(props: {
  hits: readonly WireEntry[];
  count: number;
  /** Folders are shown from here down as `~` would show home; null shows them whole. */
  home: WirePath | null;
  label: string;
  /** The part of the window the hits are shown in; its click setting decides how a hit opens. */
  area: ClickArea;
  /** True once the walk has ended: only then do the column headers sort. */
  complete: boolean;
  onOpen(entry: WireEntry, newWindow: boolean): void;
}) {
  const wide = props.area === "centre";
  const single = useSingleClick(props.area);
  const timeFormat = useViewSettings((s) => s.timeFormat);
  const { sort, choose } = useScanSort(props.label);
  const sorted = useSortedHits(props.hits, props.count, sort, props.complete && wide);
  const hits = sorted.list;
  const count = props.count;
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const head = wide ? LIST_HEADER_HEIGHT : 0;
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin: head,
    initialRect: { width: 600, height: 400 },
  });
  const at = Math.min(active, Math.max(count - 1, 0));

  const go = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    setActive(next);
    virtual.scrollToIndex(next);
  };
  const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / ROW_HEIGHT));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (count === 0) return;
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      PageDown: at + page,
      PageUp: at - page,
      Home: 0,
      End: count - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      go(moves[e.key]!);
    } else if (e.key === "Enter") {
      const hit = hits[at];
      if (!hit) return;
      e.preventDefault();
      props.onOpen(hit, e.ctrlKey || e.metaKey);
    }
  };

  const ready = props.complete;
  return (
    <>
      {sorted.error && (
        <div role="alert" className="kern-banner">
          The results could not be sorted, so they are in the order found: {errorText(sorted.error)}
          <RepeatFlash watch={sorted.error} />
        </div>
      )}
      <div ref={scroller} className="kern-hits">
        {wide && (
          <div
            role="group"
            aria-label="Sort the results"
            className={"kern-list-head" + (ready ? "" : " kern-list-head-busy")}
            style={{ height: LIST_HEADER_HEIGHT }}
            title={ready ? undefined : "Sorting is available when the walk has finished"}
          >
            {COLUMNS.map((c) => {
              const on = ready && sort?.by === c.by;
              const Arrow = sort?.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <div
                  key={c.by}
                  className={`kern-col kern-col-${c.by}`}
                  aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button type="button" disabled={!ready} onClick={() => choose(c.by)}>
                    {c.label}
                    {on && <Arrow size={12} strokeWidth={2.5} aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div
          role="listbox"
          tabIndex={0}
          aria-label={props.label}
          aria-activedescendant={count > 0 ? `kern-hit-${at}` : undefined}
          className="kern-hits-body"
          data-testid="scan-results"
          onKeyDown={onKeyDown}
        >
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const e = hits[v.index];
              if (!e) return null;
              const where = parent(e.path);
              const whereText = where ? homeRelative(where, props.home) : "";
              return (
                <div
                  key={pathKey(e.path)}
                  id={`kern-hit-${v.index}`}
                  role="option"
                  aria-selected={v.index === at}
                  data-testid="scan-hit"
                  className={"kern-row kern-hit" + (v.index === at ? " kern-selected" : "")}
                  title={displayPath(e.path)}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${v.start - head}px)` }}
                  onClick={(ev) => {
                    setActive(v.index);
                    if (single && ev.detail <= 1) props.onOpen(e, ev.ctrlKey || ev.metaKey);
                  }}
                  onDoubleClick={(ev) => {
                    if (!single) props.onOpen(e, ev.ctrlKey || ev.metaKey);
                  }}
                >
                  {wide ? (
                    <>
                      <div className="kern-col kern-col-name">
                        <FileBadge entry={e} size={ROW_HEIGHT - 12} />
                        <span className="kern-name">{e.name}</span>
                      </div>
                      <div className="kern-col kern-col-type">{fileType(e).label}</div>
                      <div className="kern-col kern-col-size">
                        {isFolder(e) ? "" : formatSize(e.len)}
                      </div>
                      <div className="kern-col kern-col-modified">
                        {formatDate(e.modified_ms, undefined, timeFormat)}
                      </div>
                      <div className="kern-col kern-col-location" title={whereText}>
                        {whereText}
                      </div>
                    </>
                  ) : (
                    <>
                      <FileBadge entry={e} size={ROW_HEIGHT - 12} />
                      <span className="kern-name">{e.name}</span>
                      <span className="kern-hit-where">{whereText}</span>
                      <span className="kern-hit-when">
                        {formatDate(e.modified_ms, undefined, timeFormat)}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
