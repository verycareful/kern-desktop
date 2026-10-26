// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { bandIndices, type Layout, type Rect } from "./band";
import type { Sel } from "./selection";

// Dragging on the empty part of the list or grid draws a band that selects
// what it touches (design 5.1). Ctrl held at the start adds to the selection.
// A press that does not move is a click on the background: it clears the
// selection unless Ctrl is held.

/** Pointer travel before a press becomes a drag, in CSS pixels (the usual slop of desktop toolkits). */
const DRAG_THRESHOLD = 4;

export function useRubberBand(props: {
  /** The scrolling element the pointer goes down in. */
  scroller: RefObject<HTMLElement | null>;
  /** The element whose top-left is the origin of the layout's coordinates. */
  inner: RefObject<HTMLElement | null>;
  layout: Layout;
  sel: Sel;
  onBand(indices: number[], additive: boolean, base: Sel): void;
  onBackgroundClick(): void;
}): { onPointerDown(e: React.PointerEvent): void; band: Rect | null } {
  const [band, setBand] = useState<Rect | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const { scroller, inner } = latest.current;
    const target = e.target as Element;
    if (e.button !== 0 || target.closest("[data-item], button, input")) return;
    const el = scroller.current;
    const box = inner.current;
    if (!el || !box) return;
    // The scrollbar is part of the scroller but not of the content.
    if (e.clientX >= el.getBoundingClientRect().left + el.clientWidth) return;
    const base = latest.current.sel;
    const additive = e.ctrlKey;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;

    const local = (x: number, y: number) => {
      const r = box.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    // In content coordinates from the start: the content may scroll under a
    // held pointer, and the corner where the press began scrolls with it.
    const origin = local(start.x, start.y);
    const onMove = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_THRESHOLD)
        return;
      dragging = true;
      const a = origin;
      const b = local(m.clientX, m.clientY);
      const rect = {
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        right: Math.max(a.x, b.x),
        bottom: Math.max(a.y, b.y),
      };
      setBand(rect);
      latest.current.onBand(bandIndices(latest.current.layout, rect), additive, base);
    };
    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
      stop.current = null;
      setBand(null);
    };
    const onUp = () => {
      if (!dragging && !additive) latest.current.onBackgroundClick();
      end();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    stop.current = end;
  }, []);

  return { onPointerDown, band };
}
