// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_DOC_MOVED,
  on,
  pathKey,
  pdfApply,
  pdfClose,
  pdfOpen,
  pdfRedo,
  pdfUndo,
  toWireError,
  type Location,
  type PdfEditAnswer,
  type PdfHandle,
  type UnlistenFn,
  type WireError,
  type WirePath,
  type WireReadOnly,
  type WireStamp,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { afterEdit, openedEdit, stampOp, type EditState, type PdfOpInput } from "./edit-state";
import { pdfDate } from "./pdf-date";
import { ensureSystemFonts } from "./system-fonts";
import { thumbCache } from "./thumb-cache";
import { useDocRegistration } from "./useDocRegistration";

// One open PDF. The hook owns the engine's handle for the document: it opens on mount, asks for
// the password an encrypted file needs, and closes the handle when the tab goes, so the engine
// never holds a document no tab shows. The document is open at one place at a time, as a text
// document is (useDocRegistration). Edits go to the engine one at a time, and what the engine
// answers (edit-state.ts) is all the hook knows of them.

export type PdfPhase = "opening" | "needs-password" | "ready" | "failed";

export interface PdfDoc {
  phase: PdfPhase;
  /** Why the file did not open; while a password is asked for, that the last one was wrong. */
  error?: WireError;
  handle?: PdfHandle;
  pages: number;
  revision: number;
  /** For each page, the revision at which it last changed; a picture of the page is keyed by it. */
  pageRevisions: readonly number[];
  /** The pages the last edit, undo or redo changed (from 0). */
  changedPages: readonly number[];
  canUndo: boolean;
  canRedo: boolean;
  /** The document differs from the file as opened; the tab is dirty while this is true. */
  modified: boolean;
  /** The file as it was opened, for the save that has to know it did not change. */
  stamp?: WireStamp;
  /** Another place holds the file: it is shown and not saved. */
  readOnly: WireReadOnly | null;
  /** An edit can be made: the document is open and no other place holds the file. */
  canEdit: boolean;
  /** Opens the file, with `password` when it is encrypted; the phase says how it went. */
  open(password?: string): Promise<void>;
  /** The password was not given: the tab fails with that as its reason. */
  cancelPassword(): void;
  /**
   * Makes one change. Changes run one at a time in the order asked. A change the engine refuses
   * leaves the document as it was and is told to the user; this never rejects.
   */
  apply(op: PdfOpInput): Promise<void>;
  /** Goes back one change; nothing happens when there is none. Never rejects. */
  undo(): Promise<void>;
  /** Goes forward one change that was undone. Never rejects. */
  redo(): Promise<void>;
  /** A change is with the engine or waiting for it. */
  busy(): boolean;
}

export interface PdfDocOptions {
  /** Where the document is open, for the backend's registry; a tab of this id by default. */
  location?: Location;
  /** The caller registered the document as open here already (an adopted tab): not again. */
  registered?: boolean;
  /** Called with whether the backend took the registration, each time it is tried. */
  onRegistered?: (ok: boolean) => void;
}

interface State {
  phase: PdfPhase;
  error?: WireError;
  handle?: PdfHandle;
  edit: EditState;
  changedPages: readonly number[];
  stamp?: WireStamp;
  readOnly: WireReadOnly | null;
}

const OPENING: State = {
  phase: "opening",
  edit: openedEdit(0, 0),
  changedPages: [],
  readOnly: null,
};

const say = (text: string) => useOps.getState().notify(text);

export function usePdfDoc(tabId: string, path: WirePath, opts: PdfDocOptions = {}): PdfDoc {
  const [state, setState] = useState<State>(OPENING);
  const key = pathKey(path);
  const latestPath = useRef(path);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latestPath.current = path;
    latest.current = state;
  });
  // Which open the answer belongs to. An answer that is not the latest one (the tab went, or the
  // file was asked for again) closes the document it opened and changes nothing.
  const generation = useRef(0);
  const handle = useRef<PdfHandle | null>(null);
  // The path a rename gave the document: the same document, not one to open again.
  const ownedKey = useRef<string | null>(null);

  const closeHandle = useCallback((h: PdfHandle) => {
    pdfClose(h).catch((e: unknown) =>
      say(`${baseName(latestPath.current)} could not be closed: ${errorText(toWireError(e))}`)
    );
  }, []);

  const release = useCallback(() => {
    generation.current += 1;
    const h = handle.current;
    handle.current = null;
    if (h !== null) closeHandle(h);
  }, [closeHandle]);

  const open = useCallback(
    async (password?: string) => {
      const mine = ++generation.current;
      setState((s) => ({ ...OPENING, readOnly: s.readOnly }));
      try {
        await ensureSystemFonts();
        const opened = await pdfOpen(latestPath.current, password);
        if (mine !== generation.current) {
          closeHandle(opened.handle);
          return;
        }
        // A document opened again replaces the one it was opened as before.
        const previous = handle.current;
        handle.current = opened.handle;
        if (previous !== null) closeHandle(previous);
        setState((s) => ({
          phase: "ready",
          handle: opened.handle,
          edit: openedEdit(opened.revision, opened.pages),
          changedPages: [],
          stamp: opened.stamp,
          readOnly: s.readOnly,
        }));
      } catch (e) {
        if (mine !== generation.current) return;
        const err = toWireError(e);
        setState((s) =>
          err.kind === "WrongPassword"
            ? {
                ...OPENING,
                phase: "needs-password",
                // The first ask has no error; a password that was tried and refused does.
                error: password === undefined ? undefined : err,
                readOnly: s.readOnly,
              }
            : { ...OPENING, phase: "failed", error: err, readOnly: s.readOnly }
        );
      }
    },
    [closeHandle]
  );

  const cancelPassword = useCallback(() => {
    setState((s) =>
      s.phase !== "needs-password"
        ? s
        : {
            ...s,
            phase: "failed",
            error: {
              kind: "NoPassword",
              message: `${baseName(latestPath.current)} is encrypted and no password was given.`,
              path: null,
              details: null,
            },
          }
    );
  }, []);

  // ---- edits ----
  // One change is with the engine at a time: each waits for the one before it, so the answers
  // come in the order the changes were asked and none is made on a document an earlier one has
  // not finished with.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const step = useCallback(
    (what: string, call: (h: PdfHandle) => Promise<PdfEditAnswer>): Promise<void> => {
      // The document this change was asked of; one closed or opened again before the change's
      // turn has nothing left for it to do.
      const asked = generation.current;
      const run = async () => {
        if (asked !== generation.current) return;
        const name = baseName(latestPath.current);
        const h = handle.current;
        const now = latest.current;
        if (h === null || now.phase !== "ready") {
          say(`${what} was not made: ${name} is not open.`);
          return;
        }
        if (now.readOnly) {
          say(`${what} was not made: ${name} is open in another place and cannot be changed here.`);
          return;
        }
        const mine = asked;
        try {
          const answer = await call(h);
          // The document was closed or opened again while the engine worked: this answer is of
          // one that is gone.
          if (mine !== generation.current) return;
          for (const page of answer.changed_pages) thumbCache.dropPage(h, page);
          setState((s) => {
            const edit = afterEdit(s.edit, answer);
            return edit === s.edit ? s : { ...s, edit, changedPages: answer.changed_pages };
          });
        } catch (e) {
          if (mine !== generation.current) return;
          say(`${what} did not apply to ${name}: ${errorText(toWireError(e))}`);
        }
      };
      // `run` never rejects, so the chain never breaks.
      pending.current += 1;
      queue.current = queue.current.then(run).finally(() => {
        pending.current -= 1;
      });
      return queue.current;
    },
    []
  );
  const busy = useCallback(() => pending.current > 0, []);
  const apply = useCallback(
    (op: PdfOpInput) => step("The change", (h) => pdfApply(h, stampOp(op, pdfDate(new Date())))),
    [step]
  );
  const undo = useCallback(() => step("Undo", (h) => pdfUndo(h)), [step]);
  const redo = useCallback(() => step("Redo", (h) => pdfRedo(h)), [step]);

  // The tab is dirty exactly while the engine says the document differs from its file.
  const { modified } = state.edit;
  useEffect(() => {
    useTabs.getState().setDirty(tabId, modified);
  }, [tabId, modified]);

  // ---- open, and close with the tab ----
  // The tab's component lives as long as the tab does, and its path changes only when the file is
  // renamed (the document stays) or saved elsewhere, so the handle is the component's: opened for
  // the path it mounts with, closed when it unmounts.
  useEffect(() => {
    if (ownedKey.current === key) return;
    void open();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => release, [release]);

  // ---- the file is renamed or moved inside Kern ----
  // The backend has registered the document under its new path already; the tab takes that path.
  // The handle stays: the bytes it holds are the file's, whatever the file is called now.
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const unlisten: UnlistenFn[] = [];
    on(EVENT_DOC_MOVED, (ev) => {
      if (pathKey(latestPath.current) !== pathKey(ev.from)) return;
      ownedKey.current = pathKey(ev.to);
      useTabs.getState().retargetDoc(tabId, ev.to);
    }).then(
      (off) => {
        if (alive) unlisten.push(off);
        else off();
      },
      (e: unknown) =>
        say(
          `${baseName(latestPath.current)} will not follow a rename or a move: ${errorText(toWireError(e))}`
        )
    );
    return () => {
      alive = false;
      unlisten.forEach((u) => u());
    };
  }, [ready, tabId]);

  // ---- registration with the backend ----
  const onHeld = useCallback((held: WireReadOnly | null) => {
    setState((s) => ({ ...s, readOnly: held }));
  }, []);
  useDocRegistration({
    tabId,
    path,
    location: opts.location,
    registered: opts.registered,
    ready,
    onHeld,
    onRegistered: opts.onRegistered,
  });

  return useMemo(
    () => ({
      phase: state.phase,
      error: state.error,
      handle: state.handle,
      pages: state.edit.pages,
      revision: state.edit.revision,
      pageRevisions: state.edit.pageRevisions,
      changedPages: state.changedPages,
      canUndo: state.edit.canUndo,
      canRedo: state.edit.canRedo,
      modified: state.edit.modified,
      stamp: state.stamp,
      readOnly: state.readOnly,
      canEdit: state.phase === "ready" && state.readOnly === null,
      open,
      cancelPassword,
      apply,
      undo,
      redo,
      busy,
    }),
    [state, open, cancelPassword, apply, undo, redo, busy]
  );
}
