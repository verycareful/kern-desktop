// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { pathKey, type WireEntry } from "../ipc";
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
import { dropPageTextSelection } from "../keys/text-selection";
import { useScanSort, useSortedHits } from "./scan-sort";
import { useSingleClick, type ClickArea } from "./view-settings";
import { isMenuKey, useHitMenuState } from "./useHitMenuState";

// The Library as cards, the grid view of the file manager over the hits of a walk. It keeps its
// own selection (the hits are not a folder, so none of the folder's file operations apply) and
// the order the list was sorted in, once the walk has ended. A right-click on a card selects it and
// gives its menu (useHitMenuState.tsx); the Menu key and Shift+F10 give the menu of the card the
// cursor is on.

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
  const [sel, setSelState] = useState<Sel>(empty);
  // Every change here is the user's, and drops the words selected on the page (text-selection.ts).
  const setSel = (next: Sel | ((s: Sel) => Sel)) => {
    dropPageTextSelection();
    setSelState(next);
  };
  const [columns, setColumns] = useState(1);
  const [reveal, setReveal] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const thumbKey = useId();
  const hitMenu = useHitMenuState(props.onOpen);

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
    if (isMenuKey(e)) {
      const hit = sel.cursor === null ? undefined : entries[sel.cursor];
      if (!hit) return;
      e.preventDefault();
      const key = pathKey(hit.path);
      const card = [...(root.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find(
        (c) => c.dataset.key === key
      );
      const r = (card ?? e.currentTarget).getBoundingClientRect();
      hitMenu.show(hit, r.left, r.bottom);
    } else if (e.key in steps) {
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
          onContextMenu={(i, ev) => {
            ev.preventDefault();
            const hit = i === null ? undefined : entries[i];
            if (i === null || !hit) return;
            setSel((s) => click(s, i));
            hitMenu.show(hit, ev.clientX, ev.clientY);
          }}
          onBand={(indices, additive, base) => setSel(rubberBand(base, indices, additive))}
          onBackgroundClick={() => setSel(empty)}
          onSeedCursor={() => setSel((s) => seedCursor(s, count))}
        />
      </div>
      {hitMenu.element}
    </>
  );
}
