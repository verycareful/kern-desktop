// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pathKey, type WirePath } from "../ipc";

// Drag and drop (design 5.1, 5.8). Inside Kern a drag is made of pointer
// events: the item under the pointer is a drop target when it carries
// `data-drop-target`, and the modifier keys are those of the pointer event.
// When the pointer leaves the window the drag becomes a native one (`dragOut`)
// that other applications can receive. A drop from another application
// arrives as kern://drop with a position and no modifier state.

/** Pointer travel before a press on an item becomes a drag, in CSS pixels: GTK's gtk-dnd-drag-threshold default. */
export const ITEM_DRAG_THRESHOLD = 8;

/** The attribute that makes an element a drop target; its value is the folder as `dropTargetValue` writes it. */
export const DROP_TARGET_ATTR = "data-drop-target";

export type DropChoice = "copy" | "move" | "ask";

export interface DragModifiers {
  ctrl: boolean;
  shift: boolean;
}

/**
 * What a drop does. Ctrl copies and Shift moves. Neither, both, or no
 * modifier state at all (a drop from another application) is a question for
 * the user: the rule for a drop with no modifier needs to know whether the
 * source and the destination are on one filesystem, and nothing the backend
 * offers says so, so nothing is decided on a guess.
 */
export function decideDrop(mods: DragModifiers | null): DropChoice {
  if (mods === null) return "ask";
  if (mods.ctrl && !mods.shift) return "copy";
  if (mods.shift && !mods.ctrl) return "move";
  return "ask";
}

export function dropTargetValue(path: WirePath): string {
  return JSON.stringify(path);
}

/** The folder a `data-drop-target` value names, or null if the value is not a path. */
export function parseDropTarget(value: string | null): WirePath | null {
  if (!value) return null;
  try {
    const v: unknown = JSON.parse(value);
    if (typeof v !== "object" || v === null) return null;
    const { k, v: text } = v as { k?: unknown; v?: unknown };
    if ((k === "Utf8" || k === "Bytes") && typeof text === "string") return { k, v: text };
    return null;
  } catch {
    return null;
  }
}

/** The drop target at a point, found from the element under it. `elementAt` is `document.elementFromPoint` unless a test gives its own. */
export function dropTargetAt(
  x: number,
  y: number,
  elementAt: (x: number, y: number) => Element | null = (px, py) =>
    document.elementFromPoint(px, py)
): { path: WirePath; el: Element } | null {
  const el = elementAt(x, y)?.closest(`[${DROP_TARGET_ATTR}]`);
  if (!el) return null;
  const path = parseDropTarget(el.getAttribute(DROP_TARGET_ATTR));
  return path ? { path, el } : null;
}

/** False for the dragged items themselves: nothing is dropped on itself. */
export function canDropOn(sources: readonly WirePath[], target: WirePath): boolean {
  const key = pathKey(target);
  return !sources.some((s) => pathKey(s) === key);
}

/** True when the pointer is beyond an edge of the window's content area. */
export function leftWindow(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

/**
 * How many physical pixels one CSS pixel of the page covers: the webview's
 * width in physical pixels over the page's width in CSS pixels (the window's
 * innerWidth). Measured, so it holds for any device scale and any interface
 * size without a claim about what devicePixelRatio includes.
 */
export function physicalPerCssPixel(physicalWidth: number, cssWidth: number): number {
  if (!(physicalWidth > 0) || !(cssWidth > 0) || !Number.isFinite(physicalWidth + cssWidth)) {
    throw new RangeError(
      `cannot tell the scale of the page from a width of ${physicalWidth} physical and ${cssWidth} CSS pixels`
    );
  }
  return physicalWidth / cssWidth;
}

/** kern://drop gives the pointer in physical pixels from the webview's corner; `ratio` is `physicalPerCssPixel`. */
export function toCssPoint(pos: { x: number; y: number }, ratio: number): { x: number; y: number } {
  return { x: pos.x / ratio, y: pos.y / ratio };
}
