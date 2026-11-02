// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@codemirror/state";
import {
  EVENT_DIR_CHANGED,
  EVENT_DIR_GONE,
  docClosed,
  docOpened,
  entryOf,
  on,
  parent,
  pathKey,
  recentTouch,
  textCheck,
  textOpen,
  textSave,
  toWireError,
  unwatchDir,
  watchDir,
  type LineEnding,
  type UnlistenFn,
  type WireEntry,
  type WireError,
  type WirePath,
  type WireReadOnly,
  type WireStamp,
  type WireText,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { registerDoc } from "./doc-controller";
import { useDocStatus } from "./doc-status";

// One open text document (design 4.3, 5.4; plan Task 26). The hook owns what
// the editor must not lose: the file as it was opened or last saved (stamp,
// line ending, byte order mark, read-only reason), whether the text differs
// from it, what the disk says about the file since, and every save.
//
// The text itself is CodeMirror's: the editor reports each new document
// (`edited`) and the hook keeps that immutable tree and the one last saved,
// never a string of either. Dirty is `!current.eq(saved)`: Text.eq skips the
// subtrees two versions share, so a keystroke costs about its own edit.
//
// The hook lives as long as the document tab does (the editor of a tab that is
// not shown stays mounted, hidden), so the registration with the backend, the
// watch and the unsaved edits are not tied to which tab is on show.
//
// A write over what is on disk without the stamp of the text as opened is made
// in exactly three places, each after the user said so: the confirmed
// Overwrite after ExternalModification, the confirmed recreate of a deleted
// file, and Save As (which first asks to Replace when something is there).

/** What a pending question to the user is about. */
export type DocPrompt =
  /** The file changed on disk since it was opened: Reload, Overwrite, Save As or Cancel. */
  | "external"
  /** The file was deleted on disk and saving would create it again. */
  | "recreate"
  /** Save As asks for a path. */
  | "saveAs";

export type SaveAsResult =
  /** Written; the tab follows the new path. */
  | { status: "saved" }
  /** Something is at the target: the user has to agree to replace it. */
  | { status: "exists"; entry: WireEntry }
  /** Nothing was written. */
  | { status: "failed"; message: string };

export interface TextDoc {
  phase: "loading" | "ready" | "failed";
  /** Why the file could not be opened, when `phase` is "failed". */
  error: WireError | null;
  /** The document as opened or reloaded; the editor starts from it. Null until opened. */
  doc: Text | null;
  /** Counts the times `doc` was replaced (open, reload), so the editor builds a fresh state. */
  generation: number;
  ending: LineEnding;
  bom: boolean;
  readOnly: WireReadOnly | null;
  /** The stamp of the file as opened or last saved; null until opened. */
  stamp: WireStamp | null;
  dirty: boolean;
  /** The file on disk is not the one that was opened or saved. */
  changedOnDisk: boolean;
  /** Nothing is at the file's path any more. */
  deletedOnDisk: boolean;
  /** The folder watch could not be set or ended: changes on disk will not be noticed. */
  watchError: WireError | null;
  /** A failure of a save, a reload or a check, in words, until the next success. */
  problem: string | null;
  prompt: DocPrompt | null;
  saving: boolean;
  /** The editor reports the document it now shows. */
  edited(doc: Text): void;
  /** Saves with the stamp as opened. Asks first when the file was deleted. No-op while read-only. */
  save(): Promise<void>;
  /** The user confirmed the question of `prompt` ("external" or "recreate"): writes without the stamp. */
  overwrite(): Promise<void>;
  /** Opens the Save As question. */
  askSaveAs(): void;
  /**
   * Writes to `target` (Save As). `replace` is what the user agreed to replace there; what is
   * there is looked at again just before the write, and anything else is asked about again.
   */
  saveAs(target: WirePath, replace: WireEntry | null): Promise<SaveAsResult>;
  /** Drops the unsaved text and reads the file again. */
  reload(): Promise<void>;
  /** Closes the question; nothing is written. */
  cancelPrompt(): void;
}

interface State {
  phase: TextDoc["phase"];
  error: WireError | null;
  doc: Text | null;
  generation: number;
  ending: LineEnding;
  bom: boolean;
  readOnly: WireReadOnly | null;
  stamp: WireStamp | null;
  dirty: boolean;
  changedOnDisk: boolean;
  deletedOnDisk: boolean;
  watchError: WireError | null;
  problem: string | null;
  prompt: DocPrompt | null;
  saving: boolean;
}

const LOADING: State = {
  phase: "loading",
  error: null,
  doc: null,
  generation: 0,
  ending: "lf",
  bom: false,
  readOnly: null,
  stamp: null,
  dirty: false,
  changedOnDisk: false,
  deletedOnDisk: false,
  watchError: null,
  problem: null,
  prompt: null,
  saving: false,
};

/** The file as the backend last described it; the editor's text is held apart from it. */
interface FileFacts {
  path: WirePath;
  stamp: WireStamp;
  ending: LineEnding;
  bom: boolean;
  readOnly: WireReadOnly | null;
}

/** Lines as CodeMirror splits them by default: \r\n, \r and \n each end one. */
const toDoc = (text: string): Text => Text.of(text.split(/\r\n?|\n/));

/**
 * Whether what is at a path is still what the user was shown: the same kind, size and
 * modification time. A file rewritten in the same millisecond to the same size is not told
 * apart; the modification time is the finest the backend reports.
 */
const sameEntry = (a: WireEntry, b: WireEntry): boolean =>
  a.kind === b.kind && a.len === b.len && a.modified_ms === b.modified_ms;

const say = (text: string) => useOps.getState().notify(text);

/** The key a document tab watches its file's folder under; folder tabs use the bare tab id. */
export const watchKeyOf = (tabId: string): string => `doc:${tabId}`;

export function useTextDoc(tabId: string, path: WirePath): TextDoc {
  const [state, setState] = useState<State>(LOADING);
  // The truth between renders: every change goes through patch, so an async
  // step reads what the step before it wrote.
  const st = useRef<State>(LOADING);
  const file = useRef<FileFacts | null>(null);
  const current = useRef<Text | null>(null);
  const saved = useRef<Text | null>(null);
  // Opens, checks, saves and reloads run one after another.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The path Save As made this document's own: its open is not repeated.
  const ownedKey = useRef<string | null>(null);
  // Every watch and unwatch of the key is chained, so the backend sees them in order.
  const watchChain = useRef<Promise<void>>(Promise.resolve());
  const ensureWatch = useRef<() => void>(() => undefined);
  const registration = useRef<Promise<unknown>>(Promise.resolve());
  const key = pathKey(path);

  const patch = useCallback((p: Partial<State>) => {
    st.current = { ...st.current, ...p };
    setState(st.current);
  }, []);

  const run = useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  /** Takes a freshly read file as the document. */
  const install = useCallback(
    (t: WireText) => {
      const doc = toDoc(t.text);
      file.current = {
        path: t.path,
        stamp: t.stamp,
        ending: t.ending,
        bom: t.bom,
        readOnly: t.read_only,
      };
      current.current = doc;
      saved.current = doc;
      patch({
        phase: "ready",
        error: null,
        doc,
        generation: st.current.generation + 1,
        ending: t.ending,
        bom: t.bom,
        readOnly: t.read_only,
        stamp: t.stamp,
        dirty: false,
        changedOnDisk: false,
        deletedOnDisk: false,
        problem: null,
        prompt: null,
      });
      useDocStatus.getState().patch(tabId, { bom: t.bom, ending: t.ending });
    },
    [patch, tabId]
  );

  // ---- open ----
  useEffect(() => {
    if (ownedKey.current === key) return;
    let alive = true;
    file.current = null;
    current.current = null;
    saved.current = null;
    patch({ ...LOADING, generation: st.current.generation });
    (async () => {
      let t: WireText;
      try {
        t = await textOpen(path);
      } catch (e) {
        if (alive) patch({ phase: "failed", error: toWireError(e) });
        return;
      }
      if (!alive) return;
      install(t);
      // Nothing about a failed Recent entry blocks editing; it is said.
      recentTouch(path).catch((e: unknown) =>
        say(`${baseName(path)} could not be added to Recent: ${errorText(toWireError(e))}`)
      );
    })();
    return () => {
      alive = false;
    };
    // `path` is named by `key`; the effect runs again only for another file.
  }, [tabId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- checking the file against the disk ----
  const check = useCallback(
    () =>
      run(async () => {
        const f = file.current;
        if (!f) return;
        try {
          const verdict = await textCheck(f.path, f.stamp);
          if (file.current !== f) return;
          patch({
            changedOnDisk: verdict === "changed",
            deletedOnDisk: verdict === "deleted",
            problem: null,
          });
        } catch (e) {
          // Not knowing is said: the banner would otherwise claim the file is as opened.
          patch({
            problem: `Kern could not check whether ${baseName(f.path)} changed on disk: ${errorText(toWireError(e))}`,
          });
        }
      }),
    [patch, run]
  );
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });

  // ---- registration with the backend, and the watch on the file's folder ----
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    const target = path;
    const location = { kind: "tab", tab_id: tabId } as const;
    const watchKey = watchKeyOf(tabId);
    let alive = true;
    let watching = false;
    const unlisten: UnlistenFn[] = [];

    // Registrations and releases go to the backend in order, so a release that follows an
    // earlier open of the same document never lands after the next open and removes it.
    const registered = registration.current
      .then(() => docOpened(target, location))
      .then(
        () => true,
        (e: unknown) => {
          say(`${baseName(target)} could not be registered as open: ${errorText(toWireError(e))}`);
          return false;
        }
      );
    registration.current = registered;

    const stopWatch = () => {
      if (!watching) return;
      watching = false;
      watchChain.current = watchChain.current.then(() =>
        unwatchDir(watchKey).catch((e: unknown) =>
          say(
            `The watch on the folder of ${baseName(target)} did not end: ${errorText(toWireError(e))}`
          )
        )
      );
    };
    const startWatch = async () => {
      await watchChain.current;
      if (!alive || watching) return;
      const folder = parent(target);
      if (!folder) {
        patch({
          watchError: {
            kind: "Ipc",
            message: "the file has no folder to watch",
            path: null,
            details: null,
          },
        });
        return;
      }
      try {
        await watchDir(watchKey, folder);
        watching = true;
        if (!alive) stopWatch();
        else patch({ watchError: null });
      } catch (e) {
        if (alive) patch({ watchError: toWireError(e) });
      }
    };
    ensureWatch.current = () => void startWatch();

    (async () => {
      // Subscribe first, so a change between the open and the watch is not missed.
      try {
        const [changed, gone] = await Promise.all([
          on(EVENT_DIR_CHANGED, (ev) => {
            if (ev.key === watchKey) void checkRef.current();
          }),
          on(EVENT_DIR_GONE, (ev) => {
            if (ev.key !== watchKey) return;
            watching = false;
            if (ev.error) patch({ watchError: ev.error });
            // The folder is gone, so the file is too, unless it came back: the check says.
            void checkRef.current().then(() => {
              if (alive && !ev.error && !st.current.deletedOnDisk) void startWatch();
            });
            if (!ev.error) patch({ deletedOnDisk: true, changedOnDisk: false });
          }),
        ]);
        if (alive) unlisten.push(changed, gone);
        else {
          changed();
          gone();
        }
      } catch (e) {
        if (alive) patch({ watchError: toWireError(e) });
      }
      await startWatch();
    })();

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
      stopWatch();
      ensureWatch.current = () => undefined;
      registration.current = registered.then((ok) => {
        if (!ok) return;
        return docClosed(target, location).catch((e: unknown) =>
          say(`${baseName(target)} could not be released: ${errorText(toWireError(e))}`)
        );
      });
    };
  }, [ready, tabId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the tab's dirty flag and the status bar's facts ----
  // A tab starts clean, so only a change of the flag is written to it.
  const published = useRef(false);
  useEffect(() => {
    if (published.current === state.dirty) return;
    published.current = state.dirty;
    useTabs.getState().setDirty(tabId, state.dirty);
  }, [tabId, state.dirty]);
  useEffect(() => () => useDocStatus.getState().clear(tabId), [tabId]);

  // ---- editing ----
  const edited = useCallback(
    (doc: Text) => {
      current.current = doc;
      const s = saved.current;
      const dirty = s === null ? false : !doc.eq(s);
      if (st.current.dirty !== dirty) patch({ dirty });
    },
    [patch]
  );

  // ---- saving ----
  /** Writes the current text to the file at its path; `stamp` null replaces whatever is there. */
  const write = useCallback(
    async (stamp: WireStamp | null) => {
      const f = file.current;
      const snap = current.current;
      if (!f || !snap) return;
      patch({ saving: true, problem: null });
      try {
        const next = await textSave(f.path, snap.toString(), f.ending, f.bom, stamp);
        file.current = { ...f, stamp: next };
        saved.current = snap;
        const now = current.current;
        patch({
          saving: false,
          stamp: next,
          dirty: now ? !now.eq(snap) : false,
          changedOnDisk: false,
          deletedOnDisk: false,
          prompt: null,
        });
        say(`Saved ${baseName(f.path)}`);
        // A file written again after its folder vanished needs its watch back.
        ensureWatch.current();
      } catch (e) {
        const err = toWireError(e);
        if (err.kind === "ExternalModification" && stamp !== null) {
          // A deleted file counts as changed to the backend; the user is told which it is.
          let deleted = false;
          try {
            deleted = (await textCheck(f.path, f.stamp)) === "deleted";
          } catch {
            deleted = false;
          }
          patch({
            saving: false,
            prompt: deleted ? "recreate" : "external",
            deletedOnDisk: deleted,
            changedOnDisk: !deleted,
          });
        } else {
          patch({
            saving: false,
            problem: `${baseName(f.path)} was not saved: ${errorText(err)}`,
          });
        }
      }
    },
    [patch]
  );

  const save = useCallback(
    () =>
      run(async () => {
        const f = file.current;
        const s = st.current;
        if (!f || s.phase !== "ready" || s.saving) return;
        if (s.readOnly) {
          say("This file is read-only. Use Save As to keep your changes in another file.");
          return;
        }
        if (s.deletedOnDisk) {
          patch({ prompt: "recreate" });
          return;
        }
        await write(f.stamp);
      }),
    [patch, run, write]
  );

  const overwrite = useCallback(
    () =>
      run(async () => {
        const s = st.current;
        const f = file.current;
        if (!f || s.phase !== "ready" || s.saving || s.readOnly) return;
        if (s.prompt !== "external" && s.prompt !== "recreate") return;
        if (s.prompt === "recreate") {
          // The user agreed to create a file that is gone. If something is at the path again
          // (restored, or written by another program) that is not what they agreed to.
          let verdict;
          try {
            verdict = await textCheck(f.path, f.stamp);
          } catch (e) {
            // The question closes, so the reason is not hidden behind it; the edit stays dirty.
            if (st.current.prompt === "recreate") patch({ prompt: null });
            patch({
              problem: `${baseName(f.path)} was not saved: Kern could not check whether it is still gone: ${errorText(toWireError(e))}`,
            });
            return;
          }
          // Cancelled while the check ran: the user no longer wants the file created.
          if (st.current.prompt !== "recreate") return;
          if (verdict !== "deleted") {
            // Something is at the path again: its folder is there to be watched again.
            ensureWatch.current();
            patch({
              prompt: verdict === "changed" ? "external" : null,
              deletedOnDisk: false,
              changedOnDisk: verdict === "changed",
            });
            // "same": the file as opened is back, so a normal save is safe.
            if (verdict === "same") await write(f.stamp);
            return;
          }
        }
        patch({ prompt: null });
        await write(null);
      }),
    [patch, run, write]
  );

  const askSaveAs = useCallback(() => {
    if (st.current.phase === "ready") patch({ prompt: "saveAs" });
  }, [patch]);

  const saveAs = useCallback(
    (target: WirePath, replace: WireEntry | null): Promise<SaveAsResult> =>
      run(async (): Promise<SaveAsResult> => {
        const f = file.current;
        const snap = current.current;
        if (!f || !snap || st.current.phase !== "ready") {
          return { status: "failed", message: "There is no open document to save." };
        }
        const targetKey = pathKey(target);
        if (targetKey === pathKey(f.path)) {
          return { status: "failed", message: "That is this file. Use Save to write it." };
        }
        const other = useTabs
          .getState()
          .tabs.find((t) => t.kind === "doc" && t.id !== tabId && pathKey(t.path) === targetKey);
        if (other) {
          return { status: "failed", message: "That file is open in another tab. Close it first." };
        }
        try {
          const entry = await entryOf(target);
          if (entry.kind === "dir") {
            return { status: "failed", message: "That is a folder. Enter a file name in it." };
          }
          if (!replace || !sameEntry(entry, replace)) return { status: "exists", entry };
        } catch (e) {
          const err = toWireError(e);
          // Nothing there is the case that goes on; anything else is not guessed at.
          if (err.kind !== "NotFound") return { status: "failed", message: errorText(err) };
        }
        patch({ saving: true, problem: null });
        let next: WireStamp;
        try {
          next = await textSave(target, snap.toString(), f.ending, f.bom, null);
        } catch (e) {
          patch({ saving: false });
          return { status: "failed", message: errorText(toWireError(e)) };
        }
        // The new file as read back gives its ending and read-only state. The baseline is the
        // stamp of the write itself: a read-back that differs means another program wrote in
        // between, and that is said, not taken as what was saved.
        let changedSince = false;
        let facts: FileFacts = {
          path: target,
          stamp: next,
          ending: f.ending,
          bom: f.bom,
          readOnly: null,
        };
        let readBack = true;
        try {
          const t = await textOpen(target);
          changedSince = t.stamp !== next;
          facts = {
            path: t.path,
            stamp: next,
            ending: t.ending,
            bom: t.bom,
            readOnly: t.read_only,
          };
        } catch (e) {
          readBack = false;
          say(
            `${baseName(target)} was saved, but could not be read back to confirm it: ${errorText(toWireError(e))}`
          );
        }
        file.current = facts;
        saved.current = snap;
        ownedKey.current = pathKey(facts.path);
        const now = current.current;
        patch({
          saving: false,
          stamp: facts.stamp,
          ending: facts.ending,
          bom: facts.bom,
          readOnly: facts.readOnly,
          dirty: now ? !now.eq(snap) : false,
          changedOnDisk: changedSince,
          deletedOnDisk: false,
          prompt: null,
          problem: null,
        });
        useDocStatus.getState().patch(tabId, { bom: facts.bom, ending: facts.ending });
        useTabs.getState().retargetDoc(tabId, facts.path);
        say(readBack ? `Saved ${baseName(target)}` : `Saved ${baseName(target)} (not read back)`);
        recentTouch(target).catch((e: unknown) =>
          say(`${baseName(target)} could not be added to Recent: ${errorText(toWireError(e))}`)
        );
        return { status: "saved" };
      }),
    [patch, run, tabId]
  );

  const reload = useCallback(
    () =>
      run(async () => {
        const f = file.current;
        if (!f) return;
        patch({ prompt: null });
        try {
          install(await textOpen(f.path));
        } catch (e) {
          patch({
            problem: `${baseName(f.path)} could not be reloaded: ${errorText(toWireError(e))}`,
          });
        }
      }),
    [install, patch, run]
  );

  const cancelPrompt = useCallback(() => patch({ prompt: null }), [patch]);

  // ---- what the actions reach (Ctrl+S, Ctrl+Shift+S) ----
  useEffect(
    () =>
      registerDoc(tabId, {
        save: () => void save(),
        askSaveAs,
        // A clean document has nothing to save, unless its file is gone and saving brings it back.
        canSave: () =>
          st.current.phase === "ready" &&
          !st.current.readOnly &&
          !st.current.saving &&
          (st.current.dirty || st.current.deletedOnDisk),
        canSaveAs: () => st.current.phase === "ready" && !st.current.saving,
      }),
    [tabId, save, askSaveAs]
  );

  return useMemo(
    () => ({
      ...state,
      edited,
      save,
      overwrite,
      askSaveAs,
      saveAs,
      reload,
      cancelPrompt,
    }),
    [state, edited, save, overwrite, askSaveAs, saveAs, reload, cancelPrompt]
  );
}
