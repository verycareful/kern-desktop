// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { displayPath, parent, pathKey, type WireEntry, type WirePath } from "../ipc";
import { homeRelative } from "../shell/home-relative";
import { FileBadge } from "./FileList";
import { formatDate } from "./format";
import { ROW_HEIGHT } from "./grid-layout";
import { useViewSettings } from "./view-settings";

// The hits of a search or of the Library, as they stream in: name and
// folder per row, virtualized, since a walk may find many thousands. One row
// is active: the arrow keys, Home and End move it, Enter opens it (Ctrl+Enter
// in a window of its own), and a double-click opens the row under the pointer.

/** Rows drawn beyond the visible ones, so a fast scroll does not show gaps. */
const OVERSCAN = 8;

export function ScanResults(props: {
  hits: readonly WireEntry[];
  count: number;
  /** Folders are shown from here down as `~` would show home; null shows them whole. */
  home: WirePath | null;
  label: string;
  onOpen(entry: WireEntry, newWindow: boolean): void;
}) {
  const { hits, count } = props;
  const density = useViewSettings((s) => s.density);
  const rowHeight = ROW_HEIGHT[density];
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    initialRect: { width: 600, height: 400 },
  });
  const at = Math.min(active, Math.max(count - 1, 0));

  const go = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    setActive(next);
    virtual.scrollToIndex(next);
  };
  const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / rowHeight));

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

  return (
    <div
      ref={scroller}
      role="listbox"
      tabIndex={0}
      aria-label={props.label}
      aria-activedescendant={count > 0 ? `kern-hit-${at}` : undefined}
      className="kern-hits"
      data-testid="scan-results"
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((v) => {
          const e = hits[v.index];
          if (!e) return null;
          const where = parent(e.path);
          return (
            <div
              key={pathKey(e.path)}
              id={`kern-hit-${v.index}`}
              role="option"
              aria-selected={v.index === at}
              data-testid="scan-hit"
              className={"kern-row kern-hit" + (v.index === at ? " kern-selected" : "")}
              title={displayPath(e.path)}
              style={{ height: rowHeight, transform: `translateY(${v.start}px)` }}
              onClick={() => setActive(v.index)}
              onDoubleClick={(ev) => props.onOpen(e, ev.ctrlKey || ev.metaKey)}
            >
              <FileBadge entry={e} size={rowHeight - 12} />
              <span className="kern-name">{e.name}</span>
              <span className="kern-hit-where">{where ? homeRelative(where, props.home) : ""}</span>
              <span className="kern-hit-when">{formatDate(e.modified_ms)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
