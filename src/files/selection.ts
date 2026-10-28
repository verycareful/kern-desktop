// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Selection as indices into the displayed list. Pure: every function returns
// a new Sel. `anchor` is where a Shift-extension starts; `cursor` is the item
// the keyboard moves from and the one that shows the focus ring.
export interface Sel {
  selected: ReadonlySet<number>;
  anchor: number | null;
  cursor: number | null;
}

export const empty: Sel = { selected: new Set(), anchor: null, cursor: null };

const one = (i: number): Sel => ({ selected: new Set([i]), anchor: i, cursor: i });

function range(a: number, b: number): Set<number> {
  const out = new Set<number>();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  return out;
}

export function click(_s: Sel, i: number): Sel {
  return one(i);
}

export function ctrlClick(s: Sel, i: number): Sel {
  const selected = new Set(s.selected);
  if (!selected.delete(i)) selected.add(i);
  return { selected, anchor: i, cursor: i };
}

export function shiftClick(s: Sel, i: number): Sel {
  if (s.anchor === null) return one(i);
  return { selected: range(s.anchor, i), anchor: s.anchor, cursor: i };
}

/**
 * The band covers `indices`. `base` is the selection when the drag began, so
 * the band can grow and shrink; with `additive` (Ctrl held) it joins that
 * selection, otherwise it replaces it.
 */
export function rubberBand(base: Sel, indices: readonly number[], additive: boolean): Sel {
  const selected = new Set(additive ? base.selected : []);
  for (const i of indices) selected.add(i);
  const first = indices[0];
  const last = indices[indices.length - 1];
  if (first === undefined || last === undefined) {
    return additive ? base : { selected, anchor: null, cursor: null };
  }
  return { selected, anchor: first, cursor: last };
}

export function selectAll(s: Sel, count: number): Sel {
  if (count <= 0) return empty;
  return {
    selected: range(0, count - 1),
    anchor: 0,
    cursor: s.cursor !== null && s.cursor < count ? s.cursor : 0,
  };
}

/**
 * The view got the keyboard with no current item: the cursor goes to the first
 * item, which is the one the view outlines, so arrow keys move on from what is
 * shown. Nothing is selected. A selection or cursor that exists is kept.
 */
export function seedCursor(s: Sel, count: number): Sel {
  if (count <= 0 || s.cursor !== null) return s;
  return { ...s, cursor: 0 };
}

export function selectNone(_s: Sel): Sel {
  return empty;
}

/**
 * Moves the cursor by `delta` items, clamped to the list (±Infinity goes to
 * either end). Without `extend` it selects just that item; with it, it
 * selects from the anchor to there. From no cursor, a forward move lands on
 * the first item and a backward one on the last.
 */
export function move(s: Sel, delta: number, extend: boolean, count: number): Sel {
  if (count <= 0) return empty;
  const from = s.cursor ?? (delta > 0 ? -1 : count);
  const to = Math.max(0, Math.min(count - 1, from + delta));
  if (!extend) return one(to);
  const anchor = s.anchor ?? s.cursor ?? to;
  return { selected: range(anchor, to), anchor, cursor: to };
}
