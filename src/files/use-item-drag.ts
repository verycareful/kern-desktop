// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef } from "react";
import type { WireEntry, WirePath } from "../ipc";
import {
  ITEM_DRAG_THRESHOLD,
  canDropOn,
  dropTargetAt,
  leftWindow,
  type DragModifiers,
} from "../ops/dnd";
import { itemsText } from "../ops/labels";

// Dragging items of a folder view (design 5.1, 5.8), made of pointer events.
// A press on an item that then travels `ITEM_DRAG_THRESHOLD` pixels starts a
// drag of the selection (of the pressed item alone when it is not selected).
// The elements that carry `data-drop-target` light up under the pointer, and
// letting go over one drops the items there with the modifier keys held at
// that moment. A drag that leaves the window becomes a native one, which other
// applications can take (`onLeave`). Nothing is moved, copied or deleted here:
// the owner of the view decides what a drop does.

const OVER = "kern-drop-over";
const DRAGGING = "kern-dragging";

export function useItemDrag(args: {
  /**
   * The items to drag when the item at `index` is pressed: the selection when
   * it holds that item, else just that item, which becomes the selection.
   * Empty when there is nothing to drag.
   */
  itemsFor(index: number): readonly WireEntry[];
  onDrop(sources: WirePath[], target: WirePath, mods: DragModifiers): void;
  onLeave(sources: WirePath[]): void;
}) {
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });
  const ghost = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as Element;
    if (e.button !== 0 || target.closest("input, button")) return;
    const item = target.closest("[data-item]");
    const index = Number(item?.getAttribute("data-index"));
    if (!item || !Number.isInteger(index)) return;
    const start = { x: e.clientX, y: e.clientY };
    let sources: WirePath[] | null = null;
    let over: Element | null = null;
    // The click that ends a press which travelled is not a click on the item under the pointer.
    const swallow = (c: Event) => c.stopPropagation();

    const light = (el: Element | null) => {
      if (el === over) return;
      over?.classList.remove(OVER);
      over = el;
      over?.classList.add(OVER);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancel);
      light(null);
      // The click, if there is one, follows the pointer-up at once; a timer runs after it.
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      document.body.classList.remove(DRAGGING);
      if (ghost.current) ghost.current.hidden = true;
      stop.current = null;
    };
    const cancel = () => finish();
    const onMove = (m: PointerEvent) => {
      if (sources === null) {
        if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < ITEM_DRAG_THRESHOLD) return;
        const entries = latest.current.itemsFor(index);
        if (entries.length === 0) {
          finish();
          return;
        }
        sources = entries.map((en) => en.path);
        document.body.classList.add(DRAGGING);
        window.addEventListener("click", swallow, true);
      }
      if (leftWindow(m.clientX, m.clientY, window.innerWidth, window.innerHeight)) {
        const out = sources;
        finish();
        latest.current.onLeave(out);
        return;
      }
      const g = ghost.current;
      if (g) {
        const verb = m.ctrlKey && !m.shiftKey ? "Copy " : m.shiftKey && !m.ctrlKey ? "Move " : "";
        g.textContent = verb + itemsText(sources);
        g.style.left = `${m.clientX + 12}px`;
        g.style.top = `${m.clientY + 12}px`;
        g.hidden = false;
      }
      const hit = dropTargetAt(m.clientX, m.clientY);
      light(hit && canDropOn(sources, hit.path) ? hit.el : null);
    };
    const onUp = (u: PointerEvent) => {
      const dragged = sources;
      const hit = dragged ? dropTargetAt(u.clientX, u.clientY) : null;
      finish();
      if (dragged && hit && canDropOn(dragged, hit.path)) {
        latest.current.onDrop(dragged, hit.path, { ctrl: u.ctrlKey, shift: u.shiftKey });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
    stop.current = finish;
  }, []);

  return { onPointerDown, ghost };
}
