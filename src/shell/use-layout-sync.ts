// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import {
  layoutGet,
  layoutSet,
  settingsGet,
  toWireError,
  type LayoutKind,
  type WindowLayout,
  type WindowLayoutPatch,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { LEFT_WIDTH_DEFAULT, RIGHT_WIDTH_DEFAULT, useLayout } from "../store/layout";

// Keeps the layout store and layout.json in step (store.rs WindowLayout). On start it reads the
// stored layout and the default layout setting; the main window then writes every change of its
// layout, column width, column visibility and tree root back, a moment after the last one so a
// drag of the divider is one write. What is read or written wrong is said, never dropped, and the
// window runs on its defaults meanwhile. A read that does not answer within a bound counts as one
// that failed. An editor window only reads (for the column width).

/** How long a change waits for the next before it is written. */
export const WRITE_DELAY_MS = 300;

/**
 * How long a read of the stored layout or the default layout setting is waited for. Both are small
 * JSON files in Kern's config folder, read at once on any healthy disk; a read that takes longer
 * means the folder is stuck (a mount that does not answer), and the main window, which draws
 * nothing until the layout is known, would stay blank. Five seconds is past any slow-but-working
 * disk and short enough that the window is not mistaken for crashed.
 */
export const LAYOUT_READ_BOUND_MS = 5000;

/** `read`, or a Timeout error if it has not answered within [`LAYOUT_READ_BOUND_MS`]. */
function boundedRead<T>(read: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject({
          kind: "Timeout",
          message: `the read did not answer within ${LAYOUT_READ_BOUND_MS / 1000} seconds`,
          path: null,
          details: null,
        }),
      LAYOUT_READ_BOUND_MS
    );
    read.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e))
    );
  });
}

const say = (text: string) => useOps.getState().notify(text);

/** What the store holds when nothing could be read: no layout chosen, the defaults. */
const UNREAD: WindowLayout = {
  layout: null,
  left_width: LEFT_WIDTH_DEFAULT,
  left_open: true,
  right_width: RIGHT_WIDTH_DEFAULT,
  tree_root: null,
};

/** Writes the main window's last change to disk now (see `flushLayout`); null while nothing syncs. */
let flushNow: (() => Promise<void>) | null = null;

/**
 * Settles every change of the layout not yet written. A window that is closing waits for this
 * before it goes, so the last change reaches the disk; a write that fails is said, as any other.
 */
export const flushLayout = (): Promise<void> => flushNow?.() ?? Promise.resolve();

/** The patch that brings `stored` to what the store holds; null when nothing differs. */
function patchFor(stored: WindowLayout, s: ReturnType<typeof useLayout.getState>) {
  const patch: WindowLayoutPatch = {};
  if (s.chosen && s.layout !== stored.layout) patch.layout = s.layout;
  if (s.leftWidth !== stored.left_width) patch.left_width = s.leftWidth;
  if (s.leftOpen !== stored.left_open) patch.left_open = s.leftOpen;
  if (s.rightWidth !== stored.right_width) patch.right_width = s.rightWidth;
  const rootChanged = JSON.stringify(s.treeRoot) !== JSON.stringify(stored.tree_root);
  if (s.treeRoot && rootChanged) patch.tree_root = s.treeRoot;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Reads the stored layout into the layout store (the defaults stand when it cannot be read) and, with `persist`, writes changes back. */
export function useLayoutSync(persist: boolean): void {
  useEffect(() => {
    let alive = true;
    let stored: WindowLayout | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let writing: Promise<unknown> = Promise.resolve();

    const flush = () => {
      timer = undefined;
      if (!stored) return;
      const patch = patchFor(stored, useLayout.getState());
      if (!patch) return;
      const sent = stored;
      writing = writing.then(async () => {
        try {
          stored = await layoutSet(patch);
        } catch (e) {
          stored = sent;
          say(`The layout of the window could not be saved: ${errorText(toWireError(e))}`);
        }
      });
    };

    (async () => {
      let fallback: LayoutKind = "file_manager";
      try {
        fallback = (await boundedRead(settingsGet())).default_layout;
      } catch (e) {
        say(
          `The default layout could not be read, so the file manager layout is used: ${errorText(toWireError(e))}`
        );
      }
      try {
        const got = await boundedRead(layoutGet());
        if (!alive) return;
        stored = got;
        if (persist) useLayout.getState().apply(got, fallback);
        else useLayout.getState().applyToEditorWindow(got);
      } catch (e) {
        if (!alive) return;
        say(`The stored layout could not be read: ${errorText(toWireError(e))}`);
        // The next change is written all the same (and said again if that fails too).
        stored = UNREAD;
        if (persist) useLayout.getState().applyDefaults(fallback);
        else useLayout.getState().applyToEditorWindow(null);
      }
    })();

    const off = persist
      ? useLayout.subscribe(() => {
          if (!stored) return;
          clearTimeout(timer);
          timer = setTimeout(flush, WRITE_DELAY_MS);
        })
      : () => undefined;
    const settle = async () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
      await writing;
    };
    if (persist) flushNow = settle;
    return () => {
      alive = false;
      off();
      if (flushNow === settle) flushNow = null;
      // What was changed last is written now, not lost with the window.
      void settle();
    };
  }, [persist]);
}
