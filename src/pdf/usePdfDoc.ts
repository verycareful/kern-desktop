// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_DOC_MOVED,
  entryOf,
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
  type PdfSource,
  type UnlistenFn,
  type WireEntry,
  type WireError,
  type WirePath,
  type WireReadOnly,
  type WireStamp,
} from "../ipc";
import { sameEntry } from "../editor/same-entry";
import { tabPlace } from "../editor/useTextDoc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { recordRecent } from "../ops/record-recent";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import {
  afterEdit,
  afterSave,
  openedEdit,
  stampOp,
  substitutionNotice,
  type ApplyOutcome,
  type EditState,
  type PdfOpInput,
} from "./edit-state";
import { pdfDate } from "./pdf-date";
import { forgetPaint } from "./page-paint";
import { refuseRemoval, reorderOrder } from "./page-ops";
import { entryAtStamp } from "./pdf-save";
import { ensureSystemFonts } from "./system-fonts";
import { thumbCache } from "./thumb-cache";
import { useDocRegistration } from "./useDocRegistration";
import { useExternalChange, type ExternalChangeState } from "./useExternalChange";
import { usePdfSave, type PdfSave } from "./usePdfSave";

// One open PDF. The hook owns the engine's handle for the document: it opens on mount, asks for
// the password an encrypted file needs, and closes the handle when the tab goes, so the engine
// never holds a document no tab shows. The document is open at one place at a time, as a text
// document is (useDocRegistration). Edits go to the engine one at a time, and what the engine
// answers (edit-state.ts) is all the hook knows of them. Writing the file, and what is asked
// before it, is usePdfSave; whether the file is still the one that was opened is
// useExternalChange.

export type PdfPhase = "opening" | "needs-password" | "ready" | "failed";

export interface PdfDoc extends PdfSave {
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
  /** An edit can be made: the document is open, no other place holds the file, and it is not moving. */
  canEdit: boolean;
  /** The next change will ask whether to keep a copy of the file first. */
  firstEditPending: boolean;
  /** The document is being handed to another window: it takes no change and no save meanwhile. */
  moving: boolean;
  setMoving(moving: boolean): void;
  /** The file on disk is not the one that was opened or saved: changed by another program, or gone. */
  externalChange: ExternalChangeState["change"];
  /** The folder watch could not be set or ended: changes on disk will not be noticed. */
  watchError: ExternalChangeState["watchError"];
  /** Opens the file, with `password` when it is encrypted; the phase says how it went. */
  open(password?: string): Promise<void>;
  /** The password was not given: the tab fails with that as its reason. */
  cancelPassword(): void;
  /**
   * Makes one change. Changes run one at a time in the order asked. A change the engine refuses
   * leaves the document as it was and is told to the user; this never rejects.
   */
  apply(op: PdfOpInput): Promise<void>;
  /**
   * Makes one change as `apply` does and says how it ended, without a notice: the caller shows a
   * refusal where the user is working. Never rejects.
   */
  applyChecked(op: PdfOpInput): Promise<ApplyOutcome>;
  /** Goes back one change; nothing happens when there is none. Never rejects. */
  undo(): Promise<void>;
  /** Goes forward one change that was undone. Never rejects. */
  redo(): Promise<void>;
  /** A change is with the engine or waiting for it. */
  busy(): boolean;
  /** The file the document was opened from, with the password it was opened with. */
  fileSource(): PdfSource;
  /** Turns `pages` (from 0) clockwise by `degrees`; no pages is no change, never every page. */
  rotatePages(pages: readonly number[], degrees: 90 | 180 | 270): Promise<void>;
  /** Takes `pages` out; one that would leave the PDF with none is refused with the reason. */
  removePages(pages: readonly number[]): Promise<void>;
  /** Moves the page `from` so that it stands at `to` (both from 0); the same place is no change. */
  reorderPages(from: number, to: number): Promise<void>;
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
  moving: boolean;
}

const OPENING: State = {
  phase: "opening",
  edit: openedEdit(0, 0),
  changedPages: [],
  readOnly: null,
  moving: false,
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
  // The path a rename or a Save As gave the document: the same document, not one to open again.
  const ownedKey = useRef<string | null>(null);
  // The stamp of the file as opened or last saved. A save replaces it at once, before any state is,
  // so a check of the file never compares it with an older one.
  const stampRef = useRef<WireStamp | undefined>(undefined);
  // What the file was opened with, for Reload and for a compacted copy of a file that did not open.
  const passwordRef = useRef<string | undefined>(undefined);
  // What the file looked like when its stamp was taken: what a rename is compared with.
  const entryRef = useRef<WireEntry | null>(null);

  const closeHandle = useCallback((h: PdfHandle) => {
    forgetPaint(h);
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
      stampRef.current = undefined;
      entryRef.current = null;
      passwordRef.current = password;
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
        // The first open of this file in the tab is an open; a Reload is not.
        else void recordRecent(latestPath.current);
        stampRef.current = opened.stamp;
        void entryAtStamp(latestPath.current, opened.stamp).then((entry) => {
          if (mine === generation.current) entryRef.current = entry;
        });
        setState((s) => ({
          phase: "ready",
          handle: opened.handle,
          edit: openedEdit(opened.revision, opened.pages),
          changedPages: [],
          stamp: opened.stamp,
          readOnly: s.readOnly,
          moving: false,
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
  // Runs `run` once everything asked before it has finished. A save runs here too, so none lands
  // between a change and the answer to it.
  const enqueue = useCallback(<T>(run: () => Promise<T>): Promise<T> => {
    pending.current += 1;
    const settled = queue.current.then(run).finally(() => {
      pending.current -= 1;
    });
    queue.current = settled.then(
      () => undefined,
      () => undefined
    );
    return settled;
  }, []);
  // `quiet`: a refusal is not said in a notice, because the caller shows it where the user is
  // working (the outcome carries it).
  const step = useCallback(
    (
      what: string,
      call: (h: PdfHandle) => Promise<PdfEditAnswer>,
      quiet = false
    ): Promise<ApplyOutcome> => {
      // The document this change was asked of; one closed or opened again before the change's
      // turn has nothing left for it to do.
      const asked = generation.current;
      const run = async (): Promise<ApplyOutcome> => {
        if (asked !== generation.current) return { status: "declined" };
        const name = baseName(latestPath.current);
        const h = handle.current;
        const now = latest.current;
        const refuse = (message: string): ApplyOutcome => {
          if (!quiet) say(message);
          return { status: "refused", message };
        };
        if (h === null || now.phase !== "ready") {
          return refuse(`${what} was not made: ${name} is not open.`);
        }
        if (now.readOnly) {
          return refuse(
            `${what} was not made: ${name} is open in another place and cannot be changed here.`
          );
        }
        if (now.moving) {
          return refuse(`${what} was not made: ${name} is moving to another window.`);
        }
        const mine = asked;
        try {
          const answer = await call(h);
          // The document was closed or opened again while the engine worked: this answer is of
          // one that is gone.
          if (mine !== generation.current) return { status: "declined" };
          for (const page of answer.changed_pages) thumbCache.dropPage(h, page);
          setState((s) => {
            const edit = afterEdit(s.edit, answer);
            return edit === s.edit ? s : { ...s, edit, changedPages: answer.changed_pages };
          });
          // A font replaced is said whoever asked: the change was made, and its text looks other
          // than the page's.
          const notes = answer.notes ?? [];
          if (notes.length > 0) say(substitutionNotice(name, notes));
          return { status: "applied", notes, revision: answer.revision };
        } catch (e) {
          if (mine !== generation.current) return { status: "declined" };
          const error = toWireError(e);
          if (!quiet) say(`${what} did not apply to ${name}: ${errorText(error)}`);
          return { status: "failed", error };
        }
      };
      // `run` never rejects, so the chain never breaks.
      return enqueue(run);
    },
    [enqueue]
  );
  const busy = useCallback(() => pending.current > 0, []);
  // Asks before the first change of an open session whether to keep a copy of the file (set below,
  // once the saving hook exists); a change the user cancels at that question is not made.
  const beforeFirstEdit = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const applyOp = useCallback(
    async (op: PdfOpInput, quiet: boolean): Promise<ApplyOutcome> => {
      if (!(await beforeFirstEdit.current())) return { status: "declined" };
      return step("The change", (h) => pdfApply(h, stampOp(op, pdfDate(new Date()))), quiet);
    },
    [step]
  );
  const apply = useCallback(
    async (op: PdfOpInput) => {
      await applyOp(op, false);
    },
    [applyOp]
  );
  const applyChecked = useCallback((op: PdfOpInput) => applyOp(op, true), [applyOp]);
  const undo = useCallback(async () => void (await step("Undo", (h) => pdfUndo(h))), [step]);
  const redo = useCallback(async () => void (await step("Redo", (h) => pdfRedo(h))), [step]);

  // Page operations: changes that move, turn or take out whole pages.
  const fileSource = useCallback(
    (): PdfSource => ({ path: latestPath.current, password: passwordRef.current }),
    []
  );
  const rotatePages = useCallback(
    async (pages: readonly number[], degrees: 90 | 180 | 270) => {
      // The engine reads no pages as every page, which is not what an empty choice means.
      if (pages.length === 0) return;
      await apply({ op: "rotate", pages: [...pages], degrees });
    },
    [apply]
  );
  const removePages = useCallback(
    async (pages: readonly number[]) => {
      const why = refuseRemoval(latest.current.edit.pages, pages);
      if (why !== null) {
        say(why);
        return;
      }
      await apply({ op: "remove", pages: [...pages] });
    },
    [apply]
  );
  const reorderPages = useCallback(
    async (from: number, to: number) => {
      const order = reorderOrder(latest.current.edit.pages, from, to);
      if (order === null) return;
      await apply({ op: "reorder", order });
    },
    [apply]
  );

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
  // A rename changes the change time of the file and so its stamp, though nothing in it: left as it
  // is, the next save would be refused as a change by another program. The file is looked at under
  // its new name, and when it is what it was when the stamp was taken (the same size and
  // modification time, before and after a stamp is taken again), the new stamp is the file's own.
  // Otherwise the stamp stays, and the check says that the file has changed.
  const ready = state.phase === "ready";
  const external = useExternalChange({ tabId, path, stamp: stampRef, ready });
  const checkRef = useRef(external.check);
  useLayoutEffect(() => {
    checkRef.current = external.check;
  });
  const retakeStamp = useCallback(
    async (to: WirePath) => {
      const mine = generation.current;
      const before = entryRef.current;
      try {
        if (before !== null && stampRef.current !== undefined) {
          const now = await entryOf(to);
          if (sameEntry(before, now)) {
            const again = await pdfOpen(to, passwordRef.current);
            closeHandle(again.handle);
            const after = await entryOf(to);
            if (mine === generation.current && sameEntry(now, after)) {
              stampRef.current = again.stamp;
              entryRef.current = after;
              setState((s) => ({ ...s, stamp: again.stamp }));
            }
          }
        }
      } catch {
        // Not read: the stamp stays, and the check that follows reports what it finds.
      }
      void checkRef.current();
    },
    [closeHandle]
  );
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const unlisten: UnlistenFn[] = [];
    on(EVENT_DOC_MOVED, (ev) => {
      if (pathKey(latestPath.current) !== pathKey(ev.from)) return;
      ownedKey.current = pathKey(ev.to);
      latestPath.current = ev.to;
      useTabs.getState().retargetDoc(tabId, ev.to);
      void retakeStamp(ev.to);
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
  }, [ready, tabId, retakeStamp]);

  // ---- registration with the backend ----
  const onHeld = useCallback((held: WireReadOnly | null) => {
    setState((s) => ({ ...s, readOnly: held }));
  }, []);
  const registration = useDocRegistration({
    tabId,
    path,
    location: opts.location,
    registered: opts.registered,
    ready,
    onHeld,
    onRegistered: opts.onRegistered,
  });

  // ---- writing the file ----
  const setMoving = useCallback((moving: boolean) => setState((s) => ({ ...s, moving })), []);
  const saved = useCallback(
    (next: { stamp: WireStamp; path?: WirePath }) => {
      stampRef.current = next.stamp;
      entryRef.current = null;
      const at = next.path ?? latestPath.current;
      if (next.path) {
        // Saved as another file: the tab follows it, and it is the same document, not one to open.
        ownedKey.current = pathKey(next.path);
        latestPath.current = next.path;
        useTabs.getState().retargetDoc(tabId, next.path);
      }
      const mine = generation.current;
      void entryAtStamp(at, next.stamp).then((entry) => {
        if (mine === generation.current) entryRef.current = entry;
      });
      // A file saved under a name nothing holds is this document's own: the other place that held
      // the old one has no claim on it.
      setState((s) => ({
        ...s,
        stamp: next.stamp,
        edit: afterSave(s.edit),
        readOnly: next.path ? null : s.readOnly,
      }));
    },
    [tabId]
  );
  const facts = useRef({ ready: false, readOnly: false, modified: false, moving: false });
  useLayoutEffect(() => {
    facts.current = {
      ready: state.phase === "ready",
      readOnly: state.readOnly !== null,
      modified: state.edit.modified,
      moving: state.moving,
    };
  });
  const here = opts.location ?? tabPlace(tabId);
  const writing = usePdfSave({
    tabId,
    here,
    latestPath,
    handle,
    stamp: stampRef,
    password: passwordRef,
    generation,
    latest: facts,
    enqueue,
    saved,
    reopen: open,
    registration,
    external,
  });
  useLayoutEffect(() => {
    beforeFirstEdit.current = writing.beforeFirstEdit;
  });

  return useMemo(
    () => ({
      ...writing,
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
      canEdit: state.phase === "ready" && state.readOnly === null && !state.moving,
      firstEditPending:
        state.phase === "ready" &&
        state.readOnly === null &&
        !state.moving &&
        writing.decidedFor !== state.handle,
      moving: state.moving,
      setMoving,
      externalChange: external.change,
      watchError: external.watchError,
      open,
      cancelPassword,
      apply,
      applyChecked,
      undo,
      redo,
      busy,
      fileSource,
      rotatePages,
      removePages,
      reorderPages,
    }),
    [
      writing,
      state,
      external.change,
      external.watchError,
      setMoving,
      open,
      cancelPassword,
      apply,
      applyChecked,
      undo,
      redo,
      busy,
      fileSource,
      rotatePages,
      removePages,
      reorderPages,
    ]
  );
}
