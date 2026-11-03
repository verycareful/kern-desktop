// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@codemirror/state";
import {
  EVENT_DIR_CHANGED,
  EVENT_DIR_GONE,
  docClosed,
  docOpenElsewhere,
  docOpened,
  entryOf,
  on,
  parent,
  pathKey,
  recentTouch,
  tabWindow,
  textCheck,
  textOpen,
  textSave,
  toWireError,
  unwatchDir,
  watchDir,
  type LineEnding,
  type Location,
  type TextExpect,
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
import type { HandedDoc } from "./handed-doc";

// One open text document (design 4.3, 5.4). The hook owns what
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
// watch and the unsaved edits are not tied to which tab is on show. A document
// handed over from another window (handed-doc.ts) starts from the text it had
// there, unsaved edits included, and is checked against the disk at once.
//
// Every save says what it expects at the path (ipc TextExpect). An ordinary
// save expects the file as opened or last saved. A file is created, never
// replacing anything that appeared meanwhile, for Save As to a path found free
// and for a deleted file written again (confirmed in its own question or with
// Save in the close question, and only while a fresh check finds it still
// gone). Whatever is there is replaced only after the user said so: the
// confirmed Overwrite after ExternalModification, and Save As's Replace while
// the target is still what they were shown.

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
  /** The target, by whatever name, is open in another place: nothing is written over it, whatever the user says. */
  | { status: "open-elsewhere"; location: Location }
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
  /** The document is being handed to another window: it cannot be edited or saved meanwhile. */
  moving: boolean;
  /** The editor reports the document it now shows. */
  edited(doc: Text): void;
  /** Saves with the stamp as opened. Asks first when the file was deleted. No-op while read-only. */
  save(): Promise<void>;
  /**
   * The user confirmed the question of `prompt`: for "external" whatever is there now is replaced;
   * for "recreate" the file is created, only while nothing is there.
   */
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
  moving: boolean;
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
  moving: false,
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

/** The place a tab of this window is registered under. */
const tabPlace = (tabId: string): Location => ({ kind: "tab", window: tabWindow(), tab_id: tabId });

const placeKey = (l: Location): string =>
  l.kind === "tab"
    ? `tab:${l.window}:${l.tab_id}`
    : l.kind === "window"
      ? `window:${l.label}`
      : `opening:${l.window}`;

/** The key a document tab watches its file's folder under; folder tabs use the bare tab id. */
export const watchKeyOf = (tabId: string): string => `doc:${tabId}`;

export interface TextDocOptions {
  /** Where the document is open, for the backend's registry; a tab of this id by default. */
  location?: Location;
  /** The document as another window handed it over; read once, when the hook opens it. */
  handed?: HandedDoc | null;
  /** The caller registered the document as open here already (an adopted tab): not again. */
  registered?: boolean;
  /** Called with whether the backend took the registration, each time the document registers. */
  onRegistered?: (ok: boolean) => void;
}

export function useTextDoc(tabId: string, path: WirePath, opts: TextDocOptions = {}): TextDoc {
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
  // The handed document belongs to the path it came with: an effect run again for that path
  // (StrictMode runs each twice) starts from it again, never from the file.
  const handed = useRef({ key, doc: opts.handed ?? null });
  // The path the caller registered already, until this hook's first registration would repeat it.
  const preRegistered = useRef(opts.registered ? key : null);
  const latestOpts = useRef(opts);
  useEffect(() => {
    latestOpts.current = opts;
  });
  const location = opts.location ?? null;
  const here = location ?? tabPlace(tabId);
  const locationKey = placeKey(here);

  // Set when the backend refused to register this document because another place has the file
  // open: the document stays read-only whatever a reload finds.
  const heldElsewhere = useRef<WireReadOnly | null>(null);
  const patch = useCallback((p: Partial<State>) => {
    if (heldElsewhere.current && "readOnly" in p) p = { ...p, readOnly: heldElsewhere.current };
    st.current = { ...st.current, ...p };
    setState(st.current);
  }, []);

  const run = useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  /** Takes `doc` as the document shown, dirty against `savedDoc`, of the file `facts` describe. */
  const take = useCallback(
    (facts: FileFacts, doc: Text, savedDoc: Text) => {
      file.current = facts;
      current.current = doc;
      saved.current = savedDoc;
      patch({
        phase: "ready",
        error: null,
        doc,
        generation: st.current.generation + 1,
        ending: facts.ending,
        bom: facts.bom,
        readOnly: facts.readOnly,
        stamp: facts.stamp,
        dirty: !doc.eq(savedDoc),
        changedOnDisk: false,
        deletedOnDisk: false,
        problem: null,
        prompt: null,
      });
      useDocStatus.getState().patch(tabId, { bom: facts.bom, ending: facts.ending });
    },
    [patch, tabId]
  );

  /** Takes a freshly read file as the document. */
  const install = useCallback(
    (t: WireText) => {
      const doc = toDoc(t.text);
      take(
        { path: t.path, stamp: t.stamp, ending: t.ending, bom: t.bom, readOnly: t.read_only },
        doc,
        doc
      );
    },
    [take]
  );

  /** The latest `check`, for the effects declared before it and the event handlers. */
  const checkRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // ---- open ----
  useEffect(() => {
    if (ownedKey.current === key) return;
    let alive = true;
    file.current = null;
    current.current = null;
    saved.current = null;
    patch({ ...LOADING, generation: st.current.generation });
    const given = handed.current.key === key ? handed.current.doc : null;
    if (given) {
      // Handed over from another window: the text it showed, not the file read again. It was
      // added to Recent when it was first opened.
      const doc = toDoc(given.text);
      const savedDoc = given.saved === given.text ? doc : toDoc(given.saved);
      take(
        {
          path,
          stamp: given.stamp,
          ending: given.ending,
          bom: given.bom,
          readOnly: given.read_only,
        },
        doc,
        savedDoc
      );
      // The file may have changed while it moved: the disk is asked at once, once this
      // render's effects have run and `check` is the current one.
      queueMicrotask(() => {
        if (alive) void checkRef.current();
      });
      return () => {
        alive = false;
      };
    }
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
  useEffect(() => {
    checkRef.current = check;
  });

  // True once the tab's component has unmounted: the tab is gone, as against an effect that runs
  // again for a new path (Save As) or place. Declared before the effects whose cleanups read it,
  // so on an unmount it is set first.
  const unmounted = useRef(false);
  // Set when the registration effect first runs: from then on it releases the document.
  const registrationRan = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // ---- registration with the backend, and the watch on the file's folder ----
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    const target = path;
    const where: Location = location ?? tabPlace(tabId);
    const watchKey = watchKeyOf(tabId);
    let alive = true;
    let watching = false;
    const unlisten: UnlistenFn[] = [];

    // Registrations and releases go to the backend in order, so a release that follows an
    // earlier open of the same document never lands after the next open and removes it.
    // Registered by the caller already: repeating it could land after the backend gave the
    // document back to another window, and take the path from it.
    const skip = preRegistered.current === key;
    preRegistered.current = null;
    registrationRan.current = true;
    const registered = registration.current
      .then(() => (skip ? undefined : docOpened(target, where)))
      .then(
        () => true,
        (e: unknown) => {
          const err = toWireError(e);
          if (err.kind === "AlreadyOpen") {
            // Another place has the file open: this copy is shown, never saved over it.
            heldElsewhere.current = { kind: "OpenElsewhere", detail: err.message };
            patch({ readOnly: heldElsewhere.current });
          } else {
            say(`${baseName(target)} could not be registered as open: ${errorText(err)}`);
          }
          return false;
        }
      );
    registration.current = registered;
    void registered.then((ok) => {
      latestOpts.current.onRegistered?.(ok);
    });

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
      // A tab that closes tells the backend its tab is gone, so whatever is held at it goes,
      // a Save As target included, whether or not this path's registration was taken. A path
      // released because the document moved to another file releases only that path.
      const gone = unmounted.current;
      registration.current = registered.then((ok) => {
        if (!ok && !gone) return;
        return (gone ? docClosed(target, where, true) : docClosed(target, where)).catch(
          (e: unknown) =>
            say(`${baseName(target)} could not be released: ${errorText(toWireError(e))}`)
        );
      });
    };
  }, [ready, tabId, key, locationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tab that closes without its registration effect ever running (its file did not open) lets
  // go of the path the backend held for it when the file was routed here.
  const latestPlace = useRef({ path, here });
  useEffect(() => {
    latestPlace.current = { path, here };
  });
  useEffect(
    () => () => {
      // An adopted document was registered by the caller; a document that got as far as
      // registering is released by that effect.
      if (registrationRan.current || latestOpts.current.registered) return;
      const { path: p, here: h } = latestPlace.current;
      docClosed(p, h, true).catch(() => undefined);
    },
    []
  );

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
  /** Writes the current text to the file at its path, as far as `expect` allows. */
  const write = useCallback(
    async (expect: TextExpect) => {
      const f = file.current;
      const snap = current.current;
      if (!f || !snap) return;
      patch({ saving: true, problem: null });
      try {
        const next = await textSave(f.path, snap.toString(), f.ending, f.bom, expect);
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
        if (err.kind === "Exists" && expect.kind === "nothing") {
          // The file was to be created again, and something took its place meanwhile: nothing
          // was written, and the user is asked about what is there now.
          ensureWatch.current();
          patch({
            saving: false,
            prompt: "external",
            deletedOnDisk: false,
            changedOnDisk: true,
          });
        } else if (err.kind === "ExternalModification" && expect.kind === "unchanged") {
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
        if (!f || s.phase !== "ready" || s.saving || s.moving) return;
        if (s.readOnly) {
          say("This file is read-only. Use Save As to keep your changes in another file.");
          return;
        }
        if (s.deletedOnDisk) {
          patch({ prompt: "recreate" });
          return;
        }
        await write({ kind: "unchanged", stamp: f.stamp });
      }),
    [patch, run, write]
  );

  const overwrite = useCallback(
    () =>
      run(async () => {
        const s = st.current;
        const f = file.current;
        if (!f || s.phase !== "ready" || s.saving || s.moving || s.readOnly) return;
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
            if (verdict === "same") await write({ kind: "unchanged", stamp: f.stamp });
            return;
          }
          // Still gone: created, and only if nothing has appeared there by the time it is written.
          patch({ prompt: null });
          await write({ kind: "nothing" });
          return;
        }
        // The user chose to replace the file that changed on disk.
        patch({ prompt: null });
        await write({ kind: "anything" });
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
        if (st.current.moving) {
          return { status: "failed", message: "The document is moving to another window." };
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
        // Open anywhere else, by any name (another tab, a document window, an editor window; a
        // link or a hard link to it too): never written over. A path found free is held for this
        // document in the same step, so nothing can open it between this check and the write; the
        // hold is let go when nothing is written, and replaced by the document's own registration
        // when the save lands. The document's own registration must have landed first, or the
        // registry could not tell the file is its own.
        await registration.current;
        const letGo = () =>
          docClosed(target, here).catch((e: unknown) =>
            say(`${baseName(target)} could not be let go: ${errorText(toWireError(e))}`)
          );
        let held: Awaited<ReturnType<typeof docOpenElsewhere>>;
        try {
          held = await docOpenElsewhere(target, here, true);
        } catch (e) {
          // The reply may have been lost after the backend made the hold: it is treated as held
          // and let go (letting go of a path that is not held does nothing).
          await letGo();
          return {
            status: "failed",
            message: `Kern could not tell whether that file is open elsewhere, so nothing was saved: ${errorText(toWireError(e))}`,
          };
        }
        // The tab closed while the question was in flight: the backend made the hold after the
        // tab's own release, so nothing else would let go of it.
        if (unmounted.current) {
          if (held.state === "free") await letGo();
          return { status: "failed", message: "The tab was closed, so nothing was saved." };
        }
        if (held.state === "own") {
          return {
            status: "failed",
            message: "That is this file under another name. Use Save to write it.",
          };
        }
        if (held.state === "elsewhere")
          return { status: "open-elsewhere", location: held.location };
        let outcome: SaveAsResult;
        try {
          outcome = await writeTo(f, snap);
        } catch (e) {
          await letGo();
          throw e;
        }
        // Saved, but the tab closed meanwhile: it will not register the new path, so the hold is
        // let go.
        if (outcome.status !== "saved" || unmounted.current) await letGo();
        return outcome;

        async function writeTo(f: FileFacts, snap: Text): Promise<SaveAsResult> {
          // What the last look found decides what the write may replace: what the user agreed to
          // replace, still as they were shown it, is replaced; where nothing is, the file is
          // created only if nothing appears meanwhile.
          let expect: TextExpect = { kind: "nothing" };
          try {
            const entry = await entryOf(target);
            if (entry.kind === "dir") {
              return { status: "failed", message: "That is a folder. Enter a file name in it." };
            }
            if (!replace || !sameEntry(entry, replace)) return { status: "exists", entry };
            expect = { kind: "anything" };
          } catch (e) {
            const err = toWireError(e);
            // Nothing there is the case that goes on; anything else is not guessed at.
            if (err.kind !== "NotFound") return { status: "failed", message: errorText(err) };
          }
          // The tab closed while the target was looked at: nothing is written for it.
          if (unmounted.current) {
            return { status: "failed", message: "The tab was closed, so nothing was saved." };
          }
          patch({ saving: true, problem: null });
          let next: WireStamp;
          try {
            next = await textSave(target, snap.toString(), f.ending, f.bom, expect);
          } catch (e) {
            patch({ saving: false });
            const err = toWireError(e);
            if (err.kind === "Exists") {
              // Something appeared at the path since it was found free: the user is asked about it.
              try {
                return { status: "exists", entry: await entryOf(target) };
              } catch (again) {
                return { status: "failed", message: errorText(toWireError(again)) };
              }
            }
            return { status: "failed", message: errorText(err) };
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
        }
      }),
    // `here` is the same place for as long as the tab id and the location are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, run, tabId, locationKey]
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

  // ---- closing (shell/useCloseGuard.ts) ----
  /**
   * Saves before a close: true when the file on disk now holds the text and nothing is left to
   * ask, so the document may go. A file deleted on disk is created again only if it is still
   * gone (the user chose Save in the close question). Anything else (a file changed by another
   * program, a failure, a read-only file) leaves the document open with its question or reason.
   */
  const saveForClose = useCallback(
    () =>
      run(async (): Promise<boolean> => {
        const f = file.current;
        const s = st.current;
        if (!f || s.phase !== "ready") return true;
        if (s.moving || s.saving) return false;
        if (s.readOnly) {
          say(
            `${baseName(f.path)} is read-only. Use Save As to keep your changes in another file.`
          );
          return false;
        }
        if (s.deletedOnDisk) {
          let verdict;
          try {
            verdict = await textCheck(f.path, f.stamp);
          } catch (e) {
            patch({
              problem: `${baseName(f.path)} was not saved: Kern could not check whether it is still gone: ${errorText(toWireError(e))}`,
            });
            return false;
          }
          if (verdict === "changed") {
            ensureWatch.current();
            patch({ prompt: "external", changedOnDisk: true, deletedOnDisk: false });
            return false;
          }
          await write(
            verdict === "deleted" ? { kind: "nothing" } : { kind: "unchanged", stamp: f.stamp }
          );
        } else if (s.dirty) {
          await write({ kind: "unchanged", stamp: f.stamp });
        }
        const after = st.current;
        return (
          !after.dirty && !after.deletedOnDisk && after.prompt === null && after.problem === null
        );
      }),
    [patch, run, write]
  );

  /** What the document holds now, for another window to take over (handed-doc.ts). */
  const snapshot = useCallback((): HandedDoc | null => {
    const f = file.current;
    const doc = current.current;
    const base = saved.current;
    if (!f || !doc || !base || st.current.phase !== "ready") return null;
    return {
      text: doc.toString(),
      saved: base === doc ? doc.toString() : base.toString(),
      stamp: f.stamp,
      ending: f.ending,
      bom: f.bom,
      read_only: f.readOnly,
    };
  }, []);

  // ---- what the actions reach (Ctrl+S, Ctrl+Shift+S) ----
  useEffect(
    () =>
      registerDoc(tabId, {
        save: () => void save(),
        askSaveAs,
        saveForClose,
        snapshot,
        setMoving: (moving: boolean) => patch({ moving }),
        busy: () => st.current.saving || st.current.moving,
        // Only a document that opened holds anything; one still loading or that failed holds nothing.
        closeRisk: () =>
          st.current.phase === "ready" && (st.current.dirty || st.current.deletedOnDisk)
            ? {
                dirty: st.current.dirty,
                deleted: st.current.deletedOnDisk,
                readOnly: st.current.readOnly !== null,
              }
            : null,
        // A clean document has nothing to save, unless its file is gone and saving brings it back.
        canSave: () =>
          st.current.phase === "ready" &&
          !st.current.readOnly &&
          !st.current.saving &&
          !st.current.moving &&
          (st.current.dirty || st.current.deletedOnDisk),
        canSaveAs: () => st.current.phase === "ready" && !st.current.saving && !st.current.moving,
      }),
    [tabId, save, askSaveAs, saveForClose, snapshot, patch]
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
