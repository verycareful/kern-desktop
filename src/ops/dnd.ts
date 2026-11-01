// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pathKey, type DragAction, type WireError, type WirePath, type WireSame } from "../ipc";

// Drag and drop (design 5.1, 5.8). Inside Kern a drag is made of pointer
// events: the item under the pointer is a drop target when it carries
// `data-drop-target`, and the modifier keys are those of the pointer event.
// When the pointer leaves the window the drag becomes a native one (`dragOut`)
// that other applications can take. A drop from another application arrives as
// kern://drop with a position, the size of the view it is measured in, and the
// actions the other application offers. During a native drag the webview gets no
// key events, so the backend reports a modifier the user held (Ctrl copies, Shift
// moves) as the `modifier` of the drop.
//
// What a drop does: Ctrl copies and Shift moves. Without one, an application that
// offers exactly one of copy and move is obeyed. Otherwise a move is what the
// source and the destination allow: the item is moved when it is on the same
// filesystem as the folder it goes to (a move is then a rename) and copied when it
// is not, item by item.
//
// Where a drop from another application lands is decided here, from the element under
// the pointer, both while the pointer passes over (kern://drag-over, answered with
// `dndTarget`) and at the drop: a folder row or Places folder entry (`data-drop-target`),
// or the body of a folder view (`data-drop-area`), and nowhere else. A point that cannot
// be resolved is refused with the reason and never sent to the folder on show.

/** Pointer travel before a press on an item becomes a drag, in CSS pixels: GTK's gtk-dnd-drag-threshold default. */
export const ITEM_DRAG_THRESHOLD = 8;

/** The attribute that makes an element a drop target; its value is the folder as `dropTargetValue` writes it. */
export const DROP_TARGET_ATTR = "data-drop-target";

/** The attribute of the body of a folder view; its value is the folder as `dropTargetValue` writes it. */
export const DROP_AREA_ATTR = "data-drop-area";

/** `by_filesystem`: the backend says per item whether the move would be a rename. */
export type DropChoice = "copy" | "move" | "by_filesystem";

export interface DragModifiers {
  ctrl: boolean;
  shift: boolean;
}

/**
 * What decides a drop before any filesystem is looked at. Ctrl alone copies and Shift alone
 * moves, whatever the other application offers. With neither, or both, or no modifier state at
 * all (a drop from another application), an application that offers exactly one of copy and
 * move gets that one; `link` and `ask` are not Kern's to act on. Anything else is left to the
 * filesystems.
 */
export function decideDrop(
  mods: DragModifiers | null,
  offered: readonly DragAction[] | null = null
): DropChoice {
  if (mods?.ctrl && !mods.shift) return "copy";
  if (mods?.shift && !mods.ctrl) return "move";
  const copy = offered?.includes("copy") ?? false;
  const move = offered?.includes("move") ?? false;
  if (copy && !move) return "copy";
  if (move && !copy) return "move";
  return "by_filesystem";
}

/** What a drop decided by the filesystems does with each source. */
export interface DropPlan {
  /** On the same filesystem as the destination: moved. */
  move: WirePath[];
  /** On another: copied. */
  copy: WirePath[];
  /** Could not be judged: shown with the error and left alone. */
  failed: { path: WirePath; error: WireError }[];
}

/**
 * Sorts the sources by the answer for each. A source whose answer failed is never acted on. An
 * answer list of another length than the sources is a broken contract, and no source is acted
 * on: each is reported as failed.
 */
export function planDrop(sources: readonly WirePath[], answers: readonly WireSame[]): DropPlan {
  const plan: DropPlan = { move: [], copy: [], failed: [] };
  if (answers.length !== sources.length) {
    const error: WireError = {
      kind: "Internal",
      message: `the filesystem check gave ${answers.length} ${answers.length === 1 ? "answer" : "answers"} for ${sources.length} sources`,
      path: null,
      details: null,
    };
    plan.failed = sources.map((path) => ({ path, error }));
    return plan;
  }
  sources.forEach((path, i) => {
    const answer = answers[i]!;
    if (answer.state === "failed") plan.failed.push({ path, error: answer.error });
    else if (answer.same) plan.move.push(path);
    else plan.copy.push(path);
  });
  return plan;
}

/** The keys a drop's `modifier` stands for: Ctrl copies, Shift moves. */
export function modsOf(modifier: "copy" | "move" | null): DragModifiers | null {
  if (modifier === "copy") return { ctrl: true, shift: false };
  if (modifier === "move") return { ctrl: false, shift: true };
  return null;
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

export interface Size {
  width: number;
  height: number;
}

/**
 * A point of kern://drop in CSS pixels. The backend gives the pointer in the webview's own units
 * together with the webview's size in the same units, and the page's size in CSS pixels
 * (`window.innerWidth` and `innerHeight`) is what the same area measures here, so the ratio is
 * measured and holds for any scale factor and any interface size.
 */
export function toCssPoint(
  pos: { x: number; y: number },
  view: Size,
  page: Size
): { x: number; y: number } {
  const sizes = [view.width, view.height, page.width, page.height];
  if (!sizes.every((n) => n > 0 && Number.isFinite(n))) {
    throw new RangeError(
      `cannot tell the scale of the page from a view of ${view.width} x ${view.height} and a page of ${page.width} x ${page.height}`
    );
  }
  return { x: (pos.x * page.width) / view.width, y: (pos.y * page.height) / view.height };
}

/** A reason from the backend (a fragment such as "it names no files") as a sentence. */
export function sentence(reason: string): string {
  if (reason === "") return "";
  const first = reason.charAt(0).toUpperCase() + reason.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** Where a drop from another application would land. */
export type Landing =
  | {
      ok: true;
      path: WirePath;
      /** The element to light up: the row or entry, or the body of the view. */
      el: Element;
      kind: "item" | "area";
    }
  | { ok: false; reason: string };

export const REASON_NOWHERE =
  "Files can be dropped on a folder, on the list of a folder tab or on a folder under Places, and not here.";
export const REASON_NO_FOLDER = "That place has no folder of its own to drop files into.";
export const REASON_UNMEASURED =
  "Kern could not tell where on the window the files are, so it cannot drop them anywhere.";
export const REASON_ITSELF = "A folder cannot be dropped into itself.";
export const REASON_NOT_A_FOLDER_TAB =
  "Files can only be dropped on a folder tab; this tab cannot take them.";

/**
 * The place a pointer at `point` (in the webview's own units, `view` big) is over, found from
 * the element under it in the page (`page` big, in CSS pixels). `sources` are the files being
 * dragged when they are known: none is dropped into itself. A point that cannot be resolved,
 * a place that takes no drop and a place whose folder cannot be read are all refused, each
 * with its own reason; nothing falls back to the folder on show.
 */
export function landingAt(
  point: { x: number; y: number },
  view: Size,
  page: Size,
  sources: readonly WirePath[] | null,
  elementAt: (x: number, y: number) => Element | null = (px, py) =>
    document.elementFromPoint(px, py)
): Landing {
  let at: { x: number; y: number };
  try {
    at = toCssPoint(point, view, page);
  } catch {
    return { ok: false, reason: REASON_UNMEASURED };
  }
  const hit = elementAt(at.x, at.y)?.closest(`[${DROP_TARGET_ATTR}], [${DROP_AREA_ATTR}]`);
  if (!hit) return { ok: false, reason: REASON_NOWHERE };
  const kind = hit.hasAttribute(DROP_TARGET_ATTR) ? "item" : "area";
  const path = parseDropTarget(
    hit.getAttribute(kind === "item" ? DROP_TARGET_ATTR : DROP_AREA_ATTR)
  );
  if (!path) return { ok: false, reason: REASON_NO_FOLDER };
  if (sources && !canDropOn(sources, path)) return { ok: false, reason: REASON_ITSELF };
  return { ok: true, path, el: hit, kind };
}
