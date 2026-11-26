// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ITEM_DRAG_THRESHOLD } from "../ops/dnd";
import { gapAt, type PageBox } from "./page-drag";

// Dragging a page of the thumbnail strip or the grid to another place, made of pointer events as
// every drag inside Kern is. A press on an element that carries `data-page-item` and then travels
// `ITEM_DRAG_THRESHOLD` pixels starts the drag; the gap under the pointer is marked while it
// moves, and letting go inside the container drops the page into that gap. A press on a button
// other than the page's own, a press with a modifier (a click that chooses pages), and a drag
// that ends outside the container or with Escape change nothing. Nothing is reordered here: the
// owner decides what a drop does.

/** The attribute a page's element carries: the page's number, from 0. */
export const PAGE_ITEM_ATTR = "data-page-item";

const DRAGGING = "kern-dragging";
const GAP_BEFORE = "kern-pdf-gap-before";
const GAP_AFTER = "kern-pdf-gap-after";

function boxesOf(container: HTMLElement): { boxes: PageBox[]; byPage: Map<number, Element> } {
  const boxes: PageBox[] = [];
  const byPage = new Map<number, Element>();
  for (const el of container.querySelectorAll(`[${PAGE_ITEM_ATTR}]`)) {
    const page = Number(el.getAttribute(PAGE_ITEM_ATTR));
    if (!Number.isInteger(page)) continue;
    const r = el.getBoundingClientRect();
    boxes.push({ page, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    byPage.set(page, el);
  }
  return { boxes, byPage };
}

export function usePageDrag(args: {
  container: React.RefObject<HTMLElement | null>;
  /** `y` for a column of thumbnails, `x` for a row or a grid. */
  axis: "x" | "y";
  /** Pages can be moved now. */
  enabled: boolean;
  /** The page `from` was dropped into `gap` (see page-drag.ts). */
  onDrop(from: number, gap: number): void;
}) {
  const latest = useRef(args);
  useLayoutEffect(() => {
    latest.current = args;
  });
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const container = latest.current.container.current;
    if (!container || !latest.current.enabled) return;
    const pressed = (e.target as Element).closest(`[${PAGE_ITEM_ATTR}]`);
    if (!pressed || !container.contains(pressed)) return;
    const from = Number(pressed.getAttribute(PAGE_ITEM_ATTR));
    if (!Number.isInteger(from)) return;
    const start = { x: e.clientX, y: e.clientY };
    let travelled = false;
    let gap: number | null = null;
    let marked: Element | null = null;
    // The click that ends a press which travelled is not a click on the page under the pointer.
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };

    const unmark = () => {
      marked?.classList.remove(GAP_BEFORE, GAP_AFTER);
      marked = null;
    };
    const mark = (target: number | null) => {
      unmark();
      if (target === null) return;
      const { byPage } = boxesOf(container);
      const before = byPage.get(target);
      const after = byPage.get(target - 1);
      if (before) {
        before.classList.add(GAP_BEFORE);
        marked = before;
      } else if (after) {
        after.classList.add(GAP_AFTER);
        marked = after;
      }
    };
    const inside = (x: number, y: number) => {
      const r = container.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKey, true);
      unmark();
      // The click, if there is one, follows the pointer-up at once; a timer runs after it.
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      document.body.classList.remove(DRAGGING);
      stop.current = null;
    };
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      k.stopPropagation();
      gap = null;
      finish();
    };
    const onMove = (m: PointerEvent) => {
      if (!travelled) {
        if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < ITEM_DRAG_THRESHOLD) return;
        travelled = true;
        document.body.classList.add(DRAGGING);
        window.addEventListener("click", swallow, true);
      }
      gap = inside(m.clientX, m.clientY)
        ? gapAt({ x: m.clientX, y: m.clientY }, boxesOf(container).boxes, latest.current.axis)
        : null;
      mark(gap);
    };
    const onUp = (u: PointerEvent) => {
      const drop =
        travelled && inside(u.clientX, u.clientY)
          ? gapAt({ x: u.clientX, y: u.clientY }, boxesOf(container).boxes, latest.current.axis)
          : null;
      finish();
      if (drop !== null) latest.current.onDrop(from, drop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKey, true);
    stop.current = finish;
  }, []);

  return { onPointerDown };
}
