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
import { useLayout } from "../store/layout";

// Keeps the layout store and layout.json in step (store.rs WindowLayout). On start it reads the
// stored layout and the default layout setting; the main window then writes every change of its
// layout, column width, column visibility and tree root back, a moment after the last one so a
// drag of the divider is one write. What is read or written wrong is said, never dropped, and the
// window runs on its defaults meanwhile. An editor window only reads (for the column width).

/** How long a change waits for the next before it is written. */
export const WRITE_DELAY_MS = 300;

const say = (text: string) => useOps.getState().notify(text);

/** The patch that brings `stored` to what the store holds; null when nothing differs. */
function patchFor(stored: WindowLayout, s: ReturnType<typeof useLayout.getState>) {
  const patch: WindowLayoutPatch = {};
  if (s.chosen && s.layout !== stored.layout) patch.layout = s.layout;
  if (s.leftWidth !== stored.left_width) patch.left_width = s.leftWidth;
  if (s.leftOpen !== stored.left_open) patch.left_open = s.leftOpen;
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
        fallback = (await settingsGet()).default_layout;
      } catch (e) {
        say(
          `The default layout could not be read, so the file manager layout is used: ${errorText(toWireError(e))}`
        );
      }
      try {
        const got = await layoutGet();
        if (!alive) return;
        stored = got;
        if (persist) useLayout.getState().apply(got, fallback);
        else useLayout.getState().applyToEditorWindow(got);
      } catch (e) {
        if (!alive) return;
        say(`The stored layout could not be read: ${errorText(toWireError(e))}`);
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
    return () => {
      alive = false;
      off();
      // What was changed last is written now, not lost with the window.
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [persist]);
}
