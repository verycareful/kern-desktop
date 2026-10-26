// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useReducer, useRef } from "react";
import {
  EVENT_THUMB,
  assetUrl,
  on,
  pathKey,
  thumbCancel,
  thumbRequest,
  toWireError,
  type ThumbSize,
  type WireEntry,
  type WireError,
} from "../ipc";
import { isFolder } from "./file-type";

// Thumbnails for the grid (design 5.4). The backend keeps one queue per key;
// this asks it only for the images on screen, and when the screen moves on it
// cancels what is still queued and asks again for what is visible, so the
// queue never holds more than a screenful.

export type ThumbState =
  | { state: "ready"; url: string }
  /** The file has no thumbnail (not decodable, or a cached failure). */
  | { state: "none" }
  | { state: "error"; error: WireError };

/**
 * The cache sizes are 128 and 256 px (Thumbnail Managing Standard 0.9.0). The
 * grid shows an image at most 128 CSS px wide, so a 1x screen takes "normal"
 * and any denser one "large", which keeps it from being scaled up.
 */
export function thumbSizeFor(devicePixelRatio: number): ThumbSize {
  return devicePixelRatio > 1 ? "large" : "normal";
}

interface Book {
  /** Asked for, no answer yet. */
  pending: Set<string>;
  /** Answered, one way or the other. */
  settled: Set<string>;
  states: Map<string, ThumbState>;
}

const newBook = (): Book => ({ pending: new Set(), settled: new Set(), states: new Map() });

/**
 * The thumbnail state per path key of the images in `visible`. `key` names the
 * view to the backend; a new key or size starts afresh and cancels the old.
 * The returned map is updated in place, and the hook re-renders its caller.
 */
export function useThumbnails(
  key: string,
  visible: readonly WireEntry[],
  size: ThumbSize
): ReadonlyMap<string, ThumbState> {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const book = useRef<Book>(newBook());

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const mine = (book.current = newBook());
    bump();
    on(EVENT_THUMB, (ev) => {
      if (!alive || ev.key !== key) return;
      const k = pathKey(ev.path);
      mine.pending.delete(k);
      mine.settled.add(k);
      if (ev.error) mine.states.set(k, { state: "error", error: ev.error });
      else if (ev.file) {
        try {
          mine.states.set(k, { state: "ready", url: assetUrl(ev.file) });
        } catch (e) {
          mine.states.set(k, { state: "error", error: toWireError(e) });
        }
      } else mine.states.set(k, { state: "none" });
      bump();
    }).then(
      (u) => (alive ? (unlisten = u) : u()),
      (e: unknown) => {
        // Without the event nothing can arrive: every image waits would be silent.
        if (!alive) return;
        for (const k of mine.pending) mine.states.set(k, { state: "error", error: toWireError(e) });
        mine.pending.clear();
        bump();
      }
    );
    return () => {
      alive = false;
      unlisten?.();
      thumbCancel(key).catch((e: unknown) => console.error("thumb_cancel failed", e));
    };
  }, [key, size]);

  useEffect(() => {
    const mine = book.current;
    const want = visible
      .filter((e) => !isFolder(e) && e.mime.startsWith("image/"))
      .map((e) => ({ k: pathKey(e.path), path: e.path }))
      .filter((w) => !mine.settled.has(w.k));
    const wanted = new Set(want.map((w) => w.k));
    const stale = [...mine.pending].some((k) => !wanted.has(k));
    let toAsk = want.filter((w) => !mine.pending.has(w.k));
    if (!stale && toAsk.length === 0) return;

    (async () => {
      if (stale) {
        mine.pending.clear();
        await thumbCancel(key);
        toAsk = want;
      }
      if (book.current !== mine || toAsk.length === 0) return;
      toAsk.forEach((w) => mine.pending.add(w.k));
      try {
        await thumbRequest(
          key,
          toAsk.map((w) => w.path),
          size
        );
      } catch (e) {
        if (book.current !== mine) throw e;
        for (const w of toAsk) {
          mine.pending.delete(w.k);
          mine.settled.add(w.k);
          mine.states.set(w.k, { state: "error", error: toWireError(e) });
        }
        bump();
      }
    })().catch((e: unknown) => {
      if (book.current !== mine) return;
      for (const w of want) {
        mine.pending.delete(w.k);
        mine.settled.add(w.k);
        mine.states.set(w.k, { state: "error", error: toWireError(e) });
      }
      bump();
    });
  }, [key, size, visible]);

  return book.current.states;
}
