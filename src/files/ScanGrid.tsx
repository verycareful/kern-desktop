// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { WireEntry } from "../ipc";
import { errorText } from "../ops/error-text";
import { RepeatFlash } from "../ops/repeat-flash";
import { FileGrid } from "./FileGrid";
import {
  click,
  ctrlClick,
  empty,
  move,
  rubberBand,
  seedCursor,
  selectAll,
  selectNone,
  shiftClick,
  type Sel,
} from "./selection";
import { useScanSort, useSortedHits } from "./scan-sort";
import { useSingleClick, type ClickArea } from "./view-settings";

// The Library as cards, the grid view of the file manager over the hits of a walk. It keeps its
// own selection (the hits are not a folder, so none of the folder's file operations apply) and
// the order the list was sorted in, once the walk has ended.

export function ScanGrid(props: {
  hits: readonly WireEntry[];
  count: number;
  label: string;
  area: ClickArea;
  /** True once the walk has ended. */
  complete: boolean;
  onOpen(entry: WireEntry, newWindow: boolean): void;
}) {
  const { count } = props;
  const single = useSingleClick(props.area);
  const { sort } = useScanSort(props.label);
  const sorted = useSortedHits(props.hits, count, sort, props.complete);
  const list = sorted.list;
  const entries = useMemo(() => list.slice(0, count), [list, count]);
  const [sel, setSel] = useState<Sel>(empty);
  const [columns, setColumns] = useState(1);
  const [reveal, setReveal] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const thumbKey = useId();

  const open = (i: number, newWindow: boolean) => {
    const hit = entries[i];
    if (hit) props.onOpen(hit, newWindow);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (count === 0) return;
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -Infinity,
      End: Infinity,
    };
    if (e.key in steps) {
      e.preventDefault();
      setSel((s) => move(s, steps[e.key]!, e.shiftKey, count));
      setReveal((t) => t + 1);
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSel((s) => selectAll(s, count));
    } else if (e.key === "Escape") {
      setSel((s) => selectNone(s));
    } else if (e.key === "Enter" && sel.cursor !== null) {
      e.preventDefault();
      open(sel.cursor, e.ctrlKey || e.metaKey);
    }
  };

  const onColumns = useCallback((n: number) => setColumns(n), []);

  return (
    <>
      {sorted.error && (
        <div role="alert" className="kern-banner">
          The results could not be sorted, so they are in the order found: {errorText(sorted.error)}
          <RepeatFlash watch={sorted.error} />
        </div>
      )}
      <div
        className="kern-hits-grid"
        data-testid="scan-grid"
        aria-label={props.label}
        onKeyDown={onKeyDown}
      >
        <FileGrid
          entries={entries}
          sel={sel}
          rootRef={root}
          revealTick={reveal}
          initialScroll={0}
          thumbKey={thumbKey}
          onColumns={onColumns}
          onItemClick={(i, ev) => {
            const plain = !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;
            setSel((s) =>
              ev.shiftKey
                ? shiftClick(s, i)
                : ev.ctrlKey || ev.metaKey
                  ? ctrlClick(s, i)
                  : click(s, i)
            );
            if (single && plain && ev.detail <= 1) open(i, false);
          }}
          onItemDoubleClick={(i, ev) => {
            if (!single) open(i, ev.ctrlKey || ev.metaKey);
          }}
          // The hits are not a folder: no menu of file operations is offered over them.
          onContextMenu={(_i, ev) => ev.preventDefault()}
          onBand={(indices, additive, base) => setSel(rubberBand(base, indices, additive))}
          onBackgroundClick={() => setSel(empty)}
          onSeedCursor={() => setSel((s) => seedCursor(s, count))}
        />
      </div>
    </>
  );
}
