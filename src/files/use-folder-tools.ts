// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clipText,
  displayPath,
  openTerminal,
  settingsGet,
  toWireError,
  type WireEntry,
  type WirePath,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName, itemsText } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { openAsEditor as openAsEditorWindow } from "../shell/layout-switch";
import { isFolder } from "./file-type";

// Copy path, Open terminal here and Open with for a folder view (each
// with its own key). Each acts on the selection, or on the folder itself where the
// selection says nothing: Copy path with nothing selected copies the folder's
// path, and the terminal opens in the one selected folder or else in the folder
// on show. What goes wrong is kept as a note for the view to show until it is
// dismissed; what succeeds is said in the status bar.

/**
 * Why `paths` cannot be copied as text one per line, or null when they can: a list of several
 * where a name has a line break would read as more paths than there are. One path on its own is
 * copied exactly as it is.
 */
export function listProblem(paths: readonly WirePath[]): string | null {
  if (paths.length < 2) return null;
  const odd = paths.find((p) => /[\r\n]/.test(displayPath(p)));
  return odd
    ? `the name of ${baseName(odd).replace(/[\r\n]+/g, " ")} has a line break in it, so one path per line would read as more paths than there are; copy it on its own`
    : null;
}

/** Why `path` cannot be copied as text, or null when it can. */
export function copyProblem(path: WirePath): string | null {
  // A Bytes path is one whose name is not UTF-8; its text has U+FFFD in it and names no file.
  return path.k === "Bytes"
    ? `the name of ${baseName(path)} is not valid UTF-8 text, so its path cannot be copied as text without changing it`
    : null;
}

/**
 * Puts `paths` on the clipboard as text, one per line; success is said in the status bar, a path
 * that cannot be copied or a failure goes to `note`.
 */
export function copyPaths(paths: readonly WirePath[], note: (text: string) => void): void {
  const problem = paths.map(copyProblem).find((p) => p !== null) ?? listProblem(paths);
  if (problem) {
    note(`The path was not copied: ${problem}.`);
    return;
  }
  clipText(paths.map(displayPath).join("\n")).then(
    () => useOps.getState().notify(`Copied the path of ${itemsText(paths)}`),
    (e: unknown) => note(`The path could not be copied: ${errorText(toWireError(e))}`)
  );
}

/**
 * Opens the terminal of the settings (else the system's) in `dir`; success is said in the status
 * bar, a failure goes to `note`.
 */
export async function openTerminalIn(dir: WirePath, note: (text: string) => void): Promise<void> {
  let setting: string | null;
  try {
    setting = (await settingsGet()).terminal;
  } catch (e) {
    note(
      `No terminal was opened: the terminal setting could not be read: ${errorText(toWireError(e))}`
    );
    return;
  }
  try {
    await openTerminal(dir, setting ?? undefined);
    useOps.getState().notify(`Opened a terminal in ${baseName(dir)}`);
  } catch (e) {
    const err = toWireError(e);
    note(
      err.kind === "NoTerminal"
        ? `No terminal could be opened (${err.message}). Choose one under Terminal in the settings, or set $TERMINAL.`
        : `A terminal could not be opened in ${baseName(dir)}: ${errorText(err)}`
    );
  }
}

export interface FolderTools {
  copyPath(): void;
  canOpenTerminal(): boolean;
  openTerminalHere(): void;
  /** True when exactly one file (not a folder) is selected. */
  canOpenWith(): boolean;
  openWith(): void;
  canOpenAsEditor(): boolean;
  openAsEditor(): void;
  /** The folder Open as editor opens: the one selected folder, or else the folder on show. */
  editorRoot(): WirePath;
  /** The file the Open with dialog is open for. */
  choosing: WireEntry | null;
  closeOpenWith(): void;
  notes: string[];
  dismissNotes(): void;
}

export function useFolderTools(args: {
  folder: WirePath;
  /** True when the folder is listed. */
  listed(): boolean;
  /** The selected entries in list order; never the outlined one. */
  selected(): WireEntry[];
}): FolderTools {
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [notes, setNotes] = useState<string[]>([]);
  const [choosing, setChoosing] = useState<WireEntry | null>(null);
  const note = useCallback((text: string) => {
    if (alive.current) setNotes((n) => (n.includes(text) ? n : [...n, text]));
  }, []);

  const copyPath = useCallback(() => {
    const picked = latest.current.selected().map((e) => e.path);
    copyPaths(picked.length > 0 ? picked : [latest.current.folder], note);
  }, [note]);

  const openTerminalHere = useCallback(() => {
    const picked = latest.current.selected();
    const only = picked.length === 1 ? picked[0] : undefined;
    void openTerminalIn(only && isFolder(only) ? only.path : latest.current.folder, note);
  }, [note]);

  const canOpenWith = useCallback(() => {
    const picked = latest.current.selected();
    return picked.length === 1 && !isFolder(picked[0]!);
  }, []);
  const openWith = useCallback(() => {
    const picked = latest.current.selected();
    if (picked.length === 1 && !isFolder(picked[0]!)) setChoosing(picked[0]!);
  }, []);

  const editorRoot = useCallback((): WirePath => {
    const picked = latest.current.selected();
    const only = picked.length === 1 ? picked[0] : undefined;
    return only && isFolder(only) ? only.path : latest.current.folder;
  }, []);
  const openAsEditor = useCallback(() => {
    void openAsEditorWindow(editorRoot());
  }, [editorRoot]);

  return useMemo(
    () => ({
      copyPath,
      canOpenTerminal: () => latest.current.listed(),
      openTerminalHere,
      canOpenWith,
      openWith,
      canOpenAsEditor: () => latest.current.listed(),
      openAsEditor,
      editorRoot,
      choosing,
      closeOpenWith: () => setChoosing(null),
      notes,
      dismissNotes: () => setNotes([]),
    }),
    [copyPath, openTerminalHere, canOpenWith, openWith, openAsEditor, editorRoot, choosing, notes]
  );
}
