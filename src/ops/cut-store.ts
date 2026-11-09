// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { create } from "zustand";
import { clipClearIf, clipGet, pathKey, toWireError, type WirePath } from "../ipc";
import { inFileKeysArea } from "../keys/file-keys";
import { isEditable } from "../keys/useShortcuts";
import { logError } from "./error-log";
import { errorText } from "./error-text";

// The files the system clipboard holds as a cut. A cut item stays where it is until it is
// pasted, so it is drawn greyed meanwhile (the `kern-cut` class). The clipboard is the one
// truth, shared with other windows and other applications, so what is greyed here is what the
// clipboard says: Kern's own cut and copy set it at once, and a read of the clipboard when the
// window gets the focus catches a cut made elsewhere and a clipboard replaced elsewhere. The
// clipboard can only be read while the window has the focus (Wayland), which is the moment the
// read is made.

interface CutState {
  /** The pathKey of every cut path. */
  keys: ReadonlySet<string>;
  /** The cut paths as the clipboard gave them, to clear exactly this cut. */
  paths: readonly WirePath[];
}

const NONE: CutState = { keys: new Set(), paths: [] };

export const useCut = create<CutState>()(() => NONE);

/** Greys exactly `paths`; an empty list greys nothing. */
export function setCut(paths: readonly WirePath[]): void {
  useCut.setState(paths.length === 0 ? NONE : { keys: new Set(paths.map(pathKey)), paths });
}

/** Nothing is cut: the clipboard was replaced, the cut was pasted, or it was cancelled. */
export function clearCut(): void {
  setCut([]);
}

/** Reads the clipboard and greys what it holds as a cut. A read that fails leaves the state as it was. */
export async function refreshCut(): Promise<void> {
  try {
    const held = await clipGet();
    if (held && held.op === "cut") setCut(held.paths);
    else clearCut();
  } catch (e) {
    const error = toWireError(e);
    // The window not having the focus yet is a moment, not a failure: the next focus reads again.
    if (error.kind !== "NoFocus") logError("clipboard", errorText(error));
  }
}

/**
 * Cancels the cut: the clipboard is cleared if it still holds exactly this cut, and the items
 * are drawn as usual again. Resolves to whether there was a cut to cancel.
 */
export async function cancelCut(): Promise<boolean> {
  const { paths } = useCut.getState();
  if (paths.length === 0) return false;
  try {
    await clipClearIf("cut", [...paths]);
  } catch (e) {
    const error = toWireError(e);
    if (error.kind !== "NoFocus") logError("clipboard", errorText(error));
    return false;
  }
  // Whether the clipboard still held this cut or something else by now, it does not hold it
  // now: a read shows what it holds.
  await refreshCut();
  return true;
}

/** Whether `target` is somewhere a bare Escape may cancel the cut: not a field, a dialog, a menu or a search. */
function escapeCancels(e: KeyboardEvent): boolean {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  if (isEditable(e.target)) return false;
  if (document.querySelector('[role="dialog"], [role="menu"], [aria-modal="true"]')) return false;
  // The Places strip and the panels beside the files are not the files' keys, but a cut is the
  // clipboard's, so only the search and the Library (which show other things) are left out.
  return (
    !(e.target instanceof Element) ||
    inFileKeysArea(e.target) ||
    e.target.closest("[role=tree]") !== null
  );
}

/** Keeps the greyed items in step with the clipboard in a window that shows files. */
export function useCutSync(): void {
  useEffect(() => {
    void refreshCut();
    const onFocus = () => void refreshCut();
    const onKey = (e: KeyboardEvent) => {
      if (useCut.getState().paths.length === 0 || !escapeCancels(e)) return;
      e.preventDefault();
      void cancelCut();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
