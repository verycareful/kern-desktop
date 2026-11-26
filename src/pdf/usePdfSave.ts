// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  docClosed,
  docOpenElsewhere,
  entryOf,
  pathKey,
  pdfCompact,
  pdfCompactFile,
  recentTouch,
  textCheck,
  toWireError,
  type Location,
  type PdfExpect,
  type PdfHandle,
  type WireEntry,
  type WirePath,
  type WireStamp,
} from "../ipc";
import { sameEntry } from "../editor/same-entry";
import type { SaveAsResult } from "../editor/useTextDoc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { copyBeside } from "./pdf-copy";
import { runSave, type SaveResult } from "./pdf-save";
import type { DocRegistrationHandle } from "./useDocRegistration";
import type { ExternalChangeState } from "./useExternalChange";

// Everything that writes a PDF, or asks about writing it: Save, Save As, a compacted copy, the
// question when the file changed on the disk, Reload, the copy made before the first edit, and the
// save a close asks for. The writes run in the queue of the edits (usePdfDoc), so a save never
// overtakes a change that was asked before it and no change lands in the middle of one. The file
// is never replaced unless the user said so: an ordinary save expects the file as opened or last
// saved, Save As expects nothing at the path (or exactly what the user was shown there), and a
// refusal of the engine is what the user is told.

/** What a pending question to the user is about. */
export type PdfPrompt =
  /** The file changed on disk since it was opened: Reload, Overwrite, Save As or Cancel. */
  | "external"
  /** The file was deleted on disk and saving would create it again. */
  | "recreate"
  /** Save As asks for a path. */
  | "saveAs"
  /** A compacted copy asks for a path. */
  | "compact"
  /** The first edit of this session: keep a copy of the file as it is, or not. */
  | "copyFirst"
  /** Reload was asked for while changes would be lost by it. */
  | "reload";

export type CopyFirstChoice = "copy" | "without" | "cancel";

const READ_ONLY_SAVE =
  "This PDF is open in another place, so it is read-only here. Use Save As to keep your changes in another file.";

/** What the saving hook reads and does of the document it belongs to. */
export interface SaveCore {
  tabId: string;
  here: Location;
  latestPath: MutableRefObject<WirePath>;
  handle: MutableRefObject<PdfHandle | null>;
  /** Of the file as opened or last saved; replaced at once by a save, before any state is. */
  stamp: MutableRefObject<WireStamp | undefined>;
  /** What the file was opened with, for a compacted copy of a file that did not open and for Reload. */
  password: MutableRefObject<string | undefined>;
  generation: MutableRefObject<number>;
  latest: MutableRefObject<{
    ready: boolean;
    readOnly: boolean;
    modified: boolean;
    moving: boolean;
  }>;
  /** Runs `run` after every change asked before it, and before any asked after. */
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  /** The file was written: its new stamp, and for a Save As its new path. */
  saved(next: { stamp: WireStamp; path?: WirePath }): void;
  /** Opens the file again, dropping what the document holds. */
  reopen(password?: string): Promise<void>;
  registration: DocRegistrationHandle;
  external: ExternalChangeState;
}

export interface PdfSave {
  saving: boolean;
  /** A failure of a save or a copy, in words, until the next success. */
  problem: string | null;
  prompt: PdfPrompt | null;
  /** The copy of the first-edit question is being made. */
  copying: boolean;
  /** The session (its handle) the user has answered the question about a copy for. */
  decidedFor: PdfHandle | null;
  /** Writes the file as it is; null when nothing was attempted (nothing to save, a question is open). */
  save(): Promise<SaveResult | null>;
  /** The user confirmed the question of `prompt` ("external", "recreate"). */
  overwrite(): Promise<void>;
  askSaveAs(): void;
  saveAs(target: WirePath, replace: WireEntry | null): Promise<SaveAsResult>;
  askCompactedCopy(): void;
  /** Writes the document (or, when it did not open, the file) as a new compacted file. */
  saveCompactedCopy(out: WirePath): Promise<SaveAsResult>;
  /** Saves for a close; true when nothing is lost by closing now. */
  saveForClose(): Promise<boolean>;
  reload(): Promise<void>;
  /** Reloads at once when nothing is lost by it, else asks. */
  askReload(): void;
  cancelPrompt(): void;
  /** Resolves true when the first change may go on (a copy was kept, or the user declined one). */
  beforeFirstEdit(): Promise<boolean>;
  answerCopyFirst(choice: CopyFirstChoice): Promise<void>;
}

const say = (text: string) => useOps.getState().notify(text);

export function usePdfSave(core: SaveCore): PdfSave {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [prompt, setPromptState] = useState<PdfPrompt | null>(null);
  const [copying, setCopying] = useState(false);
  // The session (its handle) the user has answered the copy question for.
  const [decided, setDecided] = useState<PdfHandle | null>(null);
  const c = useRef(core);
  useLayoutEffect(() => {
    c.current = core;
  });
  const promptRef = useRef<PdfPrompt | null>(null);
  const setPrompt = useCallback((p: PdfPrompt | null) => {
    promptRef.current = p;
    setPromptState(p);
  }, []);
  const busy = useRef(false);

  // ---- writing ----
  const write = useCallback(
    (expect: PdfExpect, to?: WirePath): Promise<SaveResult | null> =>
      c.current.enqueue(async () => {
        const k = c.current;
        const h = k.handle.current;
        if (h === null || !k.latest.current.ready) return null;
        const asked = k.generation.current;
        const at = to ?? k.latestPath.current;
        busy.current = true;
        setSaving(true);
        k.external.hold(true);
        try {
          const r = await runSave(h, at, expect);
          if (r.ok && asked === k.generation.current) {
            k.saved(to ? { stamp: r.stamp, path: to } : { stamp: r.stamp });
            k.external.set("none");
          }
          return r;
        } finally {
          busy.current = false;
          setSaving(false);
          k.external.hold(false);
        }
      }),
    []
  );

  /** What the user is told of a result; true when the file was written. */
  const settle = useCallback(
    async (r: SaveResult | null, expect: PdfExpect): Promise<boolean> => {
      if (r === null) return false;
      const k = c.current;
      const at = k.latestPath.current;
      const name = baseName(at);
      if (r.ok) {
        setProblem(null);
        setPrompt(null);
        say(`Saved ${name}`);
        return true;
      }
      if (r.kind === "external-modification" && expect.kind === "unchanged") {
        // A deleted file counts as changed to the engine; the user is told which it is.
        let gone = false;
        const stamp = k.stamp.current;
        if (stamp !== undefined) {
          try {
            gone = (await textCheck(at, stamp)) === "deleted";
          } catch {
            gone = false;
          }
        }
        k.external.set(gone ? "gone" : "changed");
        setPrompt(gone ? "recreate" : "external");
        setProblem(null);
      } else if (r.kind === "exists" && expect.kind === "nothing") {
        // The file was to be created again and something took its place: nothing was written.
        k.external.set("changed");
        setPrompt("external");
        setProblem(null);
      } else {
        setProblem(`${name} was not saved: ${errorText(r.error)}`);
      }
      return false;
    },
    [setPrompt]
  );

  const save = useCallback(async (): Promise<SaveResult | null> => {
    const k = c.current;
    const now = k.latest.current;
    const stamp = k.stamp.current;
    if (!now.ready || now.moving || busy.current || stamp === undefined) return null;
    if (now.readOnly) {
      say(READ_ONLY_SAVE);
      return null;
    }
    if (k.external.change === "gone") {
      setPrompt("recreate");
      return null;
    }
    if (!now.modified) return null;
    const expect: PdfExpect = { kind: "unchanged", stamp };
    const r = await write(expect);
    await settle(r, expect);
    return r;
  }, [setPrompt, settle, write]);

  const overwrite = useCallback(async (): Promise<void> => {
    const k = c.current;
    const now = k.latest.current;
    const which = promptRef.current;
    if (!now.ready || now.moving || now.readOnly || busy.current) return;
    if (which !== "external" && which !== "recreate") return;
    const at = k.latestPath.current;
    if (which === "recreate") {
      // The user agreed to create a file that is gone. If something is at the path again that is
      // not what they agreed to.
      const stamp = k.stamp.current;
      if (stamp === undefined) return;
      let verdict;
      try {
        verdict = await textCheck(at, stamp);
      } catch (e) {
        setPrompt(null);
        setProblem(
          `${baseName(at)} was not saved: Kern could not check whether it is still gone: ${errorText(toWireError(e))}`
        );
        return;
      }
      // Cancelled while the check ran: the user no longer wants the file created.
      if (promptRef.current !== "recreate") return;
      if (verdict === "changed") {
        k.external.set("changed");
        setPrompt("external");
        return;
      }
      setPrompt(null);
      const expect: PdfExpect =
        verdict === "deleted" ? { kind: "nothing" } : { kind: "unchanged", stamp };
      await settle(await write(expect), expect);
      return;
    }
    // The user chose to replace the file that changed on disk.
    setPrompt(null);
    const expect: PdfExpect = { kind: "anything" };
    await settle(await write(expect), expect);
  }, [setPrompt, settle, write]);

  const saveForClose = useCallback(async (): Promise<boolean> => {
    const k = c.current;
    const now = k.latest.current;
    const stamp = k.stamp.current;
    if (!now.ready || stamp === undefined) return true;
    if (now.moving || busy.current) return false;
    const at = k.latestPath.current;
    if (now.readOnly) {
      say(`${baseName(at)} is read-only. Use Save As to keep your changes in another file.`);
      return false;
    }
    let expect: PdfExpect = { kind: "unchanged", stamp };
    if (k.external.change === "gone") {
      let verdict;
      try {
        verdict = await textCheck(at, stamp);
      } catch (e) {
        setProblem(
          `${baseName(at)} was not saved: Kern could not check whether it is still gone: ${errorText(toWireError(e))}`
        );
        return false;
      }
      if (verdict === "changed") {
        k.external.set("changed");
        setPrompt("external");
        return false;
      }
      if (verdict === "deleted") expect = { kind: "nothing" };
    } else if (!now.modified) {
      return true;
    }
    const r = await write(expect);
    return settle(r, expect);
  }, [setPrompt, settle, write]);

  // ---- Save As, and a compacted copy ----
  const askSaveAs = useCallback(() => {
    if (c.current.latest.current.ready) setPrompt("saveAs");
  }, [setPrompt]);
  const askCompactedCopy = useCallback(() => setPrompt("compact"), [setPrompt]);

  const saveAs = useCallback(
    async (target: WirePath, replace: WireEntry | null): Promise<SaveAsResult> => {
      const k = c.current;
      const now = k.latest.current;
      const from = k.latestPath.current;
      const stamp = k.stamp.current;
      if (!now.ready || stamp === undefined || k.handle.current === null) {
        return { status: "failed", message: "There is no open document to save." };
      }
      if (now.moving) {
        return { status: "failed", message: "The document is moving to another window." };
      }
      if (busy.current) return { status: "failed", message: "A save is already under way." };
      const targetKey = pathKey(target);
      if (targetKey === pathKey(from)) {
        return { status: "failed", message: "That is this file. Use Save to write it." };
      }
      const other = useTabs
        .getState()
        .tabs.find((t) => t.kind === "doc" && t.id !== k.tabId && pathKey(t.path) === targetKey);
      if (other) {
        return { status: "failed", message: "That file is open in another tab. Close it first." };
      }
      // Open anywhere else, by any name: never written over. A path found free is held for this
      // document in the same step, so nothing can open it between this check and the write; the
      // hold is let go when nothing is written, and replaced by the document's own registration
      // when the save lands. The document's own registration must have landed first, or the
      // registry could not tell the file is its own.
      await k.registration.settled();
      const letGo = () =>
        docClosed(target, k.here).catch((e: unknown) =>
          say(`${baseName(target)} could not be let go: ${errorText(toWireError(e))}`)
        );
      let held: Awaited<ReturnType<typeof docOpenElsewhere>>;
      try {
        held = await docOpenElsewhere(target, k.here, true);
      } catch (e) {
        // The reply may have been lost after the backend made the hold: it is treated as held and
        // let go (letting go of a path that is not held does nothing).
        await letGo();
        return {
          status: "failed",
          message: `Kern could not tell whether that file is open elsewhere, so nothing was saved: ${errorText(toWireError(e))}`,
        };
      }
      if (k.registration.unmounted()) {
        if (held.state === "free") await letGo();
        return { status: "failed", message: "The tab was closed, so nothing was saved." };
      }
      if (held.state === "own") {
        return {
          status: "failed",
          message: "That is this file under another name. Use Save to write it.",
        };
      }
      if (held.state === "elsewhere") return { status: "open-elsewhere", location: held.location };

      const outcome = await (async (): Promise<SaveAsResult> => {
        // What the last look found decides what the write may replace: what the user agreed to
        // replace, still as they were shown it, is replaced; where nothing is, the file is
        // created only if nothing appears meanwhile.
        let expect: PdfExpect = { kind: "nothing" };
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
        if (k.registration.unmounted()) {
          return { status: "failed", message: "The tab was closed, so nothing was saved." };
        }
        const r = await write(expect, target);
        if (r === null) return { status: "failed", message: "There is no open document to save." };
        if (r.ok) {
          setProblem(null);
          setPrompt(null);
          say(`Saved ${baseName(target)}`);
          recentTouch(target).catch((e: unknown) =>
            say(`${baseName(target)} could not be added to Recent: ${errorText(toWireError(e))}`)
          );
          return { status: "saved" };
        }
        if (r.kind === "exists") {
          // Something appeared at the path since it was found free: the user is asked about it.
          try {
            return { status: "exists", entry: await entryOf(target) };
          } catch (again) {
            return { status: "failed", message: errorText(toWireError(again)) };
          }
        }
        return { status: "failed", message: errorText(r.error) };
      })();
      // Nothing was written, or the tab closed meanwhile (it will not register the new path): the
      // hold is let go.
      if (outcome.status !== "saved" || k.registration.unmounted()) await letGo();
      return outcome;
    },
    [setPrompt, write]
  );

  const saveCompactedCopy = useCallback(
    async (out: WirePath): Promise<SaveAsResult> => {
      const k = c.current;
      const from = k.latestPath.current;
      if (pathKey(out) === pathKey(from)) {
        return {
          status: "failed",
          message: "That is the open file. A compacted copy is a new file; choose another name.",
        };
      }
      const exists: SaveAsResult = {
        status: "failed",
        message:
          "A file with that name is already there. Kern never writes a compacted copy over a file; choose another name.",
      };
      try {
        const h = k.handle.current;
        if (h !== null && k.latest.current.ready) {
          // After every change asked before it, so the copy holds them.
          await k.enqueue(() => pdfCompact(h, out));
        } else {
          await pdfCompactFile({ path: from, password: k.password.current }, out);
        }
      } catch (e) {
        const err = toWireError(e);
        return err.kind === "Exists" ? exists : { status: "failed", message: errorText(err) };
      }
      setPrompt(null);
      say(`Saved a compacted copy as ${baseName(out)}`);
      return { status: "saved" };
    },
    [setPrompt]
  );

  const reload = useCallback(async (): Promise<void> => {
    const k = c.current;
    setPrompt(null);
    setProblem(null);
    await k.reopen(k.password.current);
    k.external.set("none");
    void k.external.check();
  }, [setPrompt]);

  const askReload = useCallback(() => {
    if (c.current.latest.current.modified) setPrompt("reload");
    else void reload();
  }, [reload, setPrompt]);

  const cancelPrompt = useCallback(() => {
    if (promptRef.current === "copyFirst") {
      void answer.current("cancel");
      return;
    }
    setPrompt(null);
  }, [setPrompt]);

  // ---- the copy before the first edit ----
  const asking = useRef<Promise<boolean> | null>(null);
  const resolver = useRef<((go: boolean) => void) | null>(null);
  const decidedRef = useRef<PdfHandle | null>(null);
  const answer = useRef<(choice: CopyFirstChoice) => Promise<void>>(async () => undefined);

  const beforeFirstEdit = useCallback((): Promise<boolean> => {
    const k = c.current;
    const now = k.latest.current;
    const h = k.handle.current;
    // A document that cannot be changed says so itself; nothing is asked on its account.
    if (h === null || !now.ready || now.readOnly || now.moving) return Promise.resolve(true);
    if (decidedRef.current === h) return Promise.resolve(true);
    if (!asking.current) {
      asking.current = new Promise<boolean>((resolve) => {
        resolver.current = resolve;
      });
      setPrompt("copyFirst");
    }
    return asking.current;
  }, [setPrompt]);

  const answerCopyFirst = useCallback(
    async (choice: CopyFirstChoice): Promise<void> => {
      const k = c.current;
      const done = (go: boolean) => {
        const resolve = resolver.current;
        asking.current = null;
        resolver.current = null;
        setPrompt(null);
        resolve?.(go);
      };
      const h = k.handle.current;
      if (promptRef.current !== "copyFirst" || h === null) return;
      if (choice === "cancel") {
        done(false);
        return;
      }
      if (choice === "copy") {
        const at = k.latestPath.current;
        setCopying(true);
        try {
          const dest = await copyBeside(at);
          say(`Kept a copy of ${baseName(at)} as ${baseName(dest)}`);
        } catch (e) {
          setCopying(false);
          setProblem(
            `${baseName(at)} was not copied, so nothing was changed: ${errorText(toWireError(e))}`
          );
          done(false);
          return;
        }
        setCopying(false);
        setProblem(null);
      }
      decidedRef.current = h;
      setDecided(h);
      done(true);
    },
    [setPrompt]
  );
  useEffect(() => {
    answer.current = answerCopyFirst;
  }, [answerCopyFirst]);

  return useMemo(
    () => ({
      saving,
      problem,
      prompt,
      copying,
      decidedFor: decided,
      save,
      overwrite,
      askSaveAs,
      saveAs,
      askCompactedCopy,
      saveCompactedCopy,
      saveForClose,
      reload,
      askReload,
      cancelPrompt,
      beforeFirstEdit,
      answerCopyFirst,
    }),
    [
      saving,
      problem,
      prompt,
      copying,
      decided,
      save,
      overwrite,
      askSaveAs,
      saveAs,
      askCompactedCopy,
      saveCompactedCopy,
      saveForClose,
      reload,
      askReload,
      cancelPrompt,
      beforeFirstEdit,
      answerCopyFirst,
    ]
  );
}
