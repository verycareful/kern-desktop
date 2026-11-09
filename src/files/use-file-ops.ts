// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  clipGet,
  clipSet,
  createDir,
  createFile,
  pathKey,
  rename as renameItem,
  toWireError,
  type WireEntry,
  type WireError,
  type WirePath,
  type WireReport,
} from "../ipc";
import type { DropChoice } from "../ops/dnd";
import { dropItems } from "../ops/drop-items";
import { editErrorText } from "../ops/edit-error";
import { baseName, itemsText, namesText } from "../ops/labels";
import { nameIsText, nameProblem } from "../ops/names";
import { clearCut, setCut } from "../ops/cut-store";
import { clearSpentCut } from "../ops/spent-cut";
import { useOps } from "../ops/useOps";
import type { FolderController } from "./folder-controller";

// The file operations of one folder view: create,
// rename, copy, cut, paste, trash, delete for good, and what is dropped on the
// folder. Every one of them acts on what the view hands over as selected, and
// on nothing else: an item that is only outlined is never touched. The question
// (delete for good) is frozen when it is asked: it names the items it was asked
// about, and a selection that changes while it is open does not change what the
// answer does. Whatever fails is kept in `problems` and shown by the view until
// it is dismissed.

/** A question waiting for an answer, with what it is about. */
export type Question = { kind: "delete"; items: { path: WirePath; name: string }[] };

/** Something that went wrong, with the item it is about when it is about one. */
export interface Problem {
  id: number;
  error: WireError;
  /** The name of the item, when the problem is that one item's. */
  about?: string;
}

/** The name being edited in place. */
export interface RenameState {
  /** The item, by path key, so the edit follows it through a new listing. */
  key: string;
  /** The item's real path: a name that is not UTF-8 is renamed by its bytes. */
  path: WirePath;
  /** The name as the listing showed it. */
  original: string;
  /** Select the name without its extension when the editor opens. */
  stem: boolean;
  text: string;
  error: string | null;
  busy: boolean;
}

export interface FileOpsArgs {
  /** The folder the view shows. */
  folder: WirePath;
  /** The selected entries in list order: never the outlined one. */
  selected(): WireEntry[];
  /** True when the folder is listed. */
  ready(): boolean;
  relist(): Promise<boolean>;
  selectKeys(keys: readonly string[], onlyIfListed?: boolean): void;
  /** Brings the cursor into view. */
  reveal(): void;
  /** Gives the keyboard back to the list. */
  focusList(): void;
}

type FileOpsController = Pick<
  FolderController,
  | "canCreate"
  | "newFolder"
  | "newFile"
  | "canRename"
  | "rename"
  | "copy"
  | "cut"
  | "paste"
  | "trash"
  | "askDelete"
>;

/** What a name's bytes that are not UTF-8 are shown as. */
const REPLACEMENT = "\ufffd";

/** What a question asked, in a few words. */
function describeQuestion(q: Question): string {
  return `Delete ${namesText(q.items.map((i) => i.name))} for good`;
}

/** True when a move ended with every source moved: nothing failed, was skipped, cancelled or not reached. */
function movedEverything(end: { report: WireReport | null; error: WireError | null }): boolean {
  const r = end.report;
  return (
    end.error === null &&
    r !== null &&
    r.done.length > 0 &&
    r.failed.length === 0 &&
    r.skipped.length === 0 &&
    r.not_reached.length === 0 &&
    !r.cancelled
  );
}

/** Where the extension starts, or -1: a leading dot is part of the name, not an extension. */
function extensionStart(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : -1;
}

/** The part of `name` an in-place edit selects first: all of a folder's, the stem of a file's. */
export function selectedRange(name: string, stem: boolean): [number, number] {
  const dot = extensionStart(name);
  return [0, stem && dot > 0 ? dot : name.length];
}

export function useFileOps(args: FileOpsArgs) {
  const latest = useRef(args);
  useLayoutEffect(() => {
    latest.current = args;
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const [naming, setNaming] = useState<"folder" | "file" | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const renamingNow = useRef<RenameState | null>(null);
  useLayoutEffect(() => {
    renamingNow.current = renaming;
  });
  const [asking, setAsking] = useState<Question | null>(null);
  const askingNow = useRef<Question | null>(null);
  // A question that comes while another is open replaces it; the one that went is named, so it
  // does not just vanish.
  const ask = useCallback((q: Question | null) => {
    const prior = askingNow.current;
    askingNow.current = q;
    setAsking(q);
    if (q && prior) {
      useOps
        .getState()
        .notify(`A new question replaced the one that was open (${describeQuestion(prior)}).`);
    }
  }, []);
  const [problems, setProblems] = useState<Problem[]>([]);
  const nextProblem = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (!alive.current) return;
    const error = toWireError(e);
    setProblems((list) => [...list, { id: nextProblem.current++, error }]);
  }, []);

  // A failure of something that outlives the view (a drop is judged after the view may be gone):
  // shown in the view while it is there, else as a report.
  const failAfter = useCallback((e: unknown, about?: WirePath) => {
    const error = toWireError(e);
    const name = about ? baseName(about) : undefined;
    if (alive.current) {
      setProblems((list) => [...list, { id: nextProblem.current++, error, about: name }]);
    } else {
      useOps.getState().report({
        title: name ? `Dropping ${name}` : "Dropping files",
        report: null,
        error,
      });
    }
  }, []);

  // Puts the selection on the items that appeared in this folder, once it has listed them.
  const showResult = useCallback((paths: readonly WirePath[]) => {
    const keys = paths.map(pathKey);
    if (keys.length === 0) return;
    void latest.current.relist().then((listed) => {
      if (!listed || !alive.current) return;
      latest.current.selectKeys(keys, true);
      latest.current.reveal();
    });
  }, []);

  const showDone = useCallback(
    (report: WireReport | null) => {
      if (report) showResult(report.done.flatMap((d) => (d.dest ? [d.dest] : [])));
    },
    [showResult]
  );

  const put = useCallback(
    async (op: "copy" | "cut") => {
      const list = latest.current.selected();
      if (list.length === 0) return;
      try {
        await clipSet(
          op,
          list.map((e) => e.path)
        );
        // The clipboard now holds this cut, or this copy in place of a cut.
        if (op === "cut") setCut(list.map((e) => e.path));
        else clearCut();
        useOps
          .getState()
          .notify(
            `${op === "copy" ? "Copied" : "Cut"} ${itemsText(list.map((e) => e.path))} to the clipboard`
          );
      } catch (e) {
        fail(e);
      }
    },
    [fail]
  );

  const paste = useCallback(async () => {
    if (!latest.current.ready()) return;
    const dest = latest.current.folder;
    try {
      const clip = await clipGet();
      if (!clip) {
        useOps.getState().notify("The clipboard holds no files.");
        return;
      }
      void useOps.getState().start({
        kind: clip.op === "cut" ? "move" : "copy",
        sources: clip.paths,
        dest,
        onEnd: (end) => {
          showDone(end.report);
          // A cut that was fully moved is spent: the clipboard is cleared, if it still holds that
          // cut, as soon as the window has the focus. One that left anything behind (a failure, a
          // skip, a cancel) stays, so it can be pasted again; what already moved is then
          // reported as not found.
          if (clip.op === "cut" && movedEverything(end)) {
            clearCut();
            void clearSpentCut(clip.paths);
          }
        },
      });
    } catch (e) {
      fail(e);
    }
  }, [fail, showDone]);

  const startRename = useCallback(() => {
    const list = latest.current.selected();
    const [only] = list;
    if (list.length !== 1 || !only) return;
    setRenaming({
      key: pathKey(only.path),
      path: only.path,
      original: only.name,
      stem: only.kind !== "dir" && !only.target_is_dir,
      text: only.name,
      error: null,
      busy: false,
    });
  }, []);

  const editRename = useCallback((text: string) => {
    setRenaming((r) => (r ? { ...r, text, error: null } : r));
  }, []);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    latest.current.focusList();
  }, []);

  const commitRename = useCallback(async () => {
    const r = renamingNow.current;
    if (!r || r.busy) return;
    if (r.text === r.original) {
      cancelRename();
      return;
    }
    // A name that is not UTF-8 is shown with U+FFFD for its bad bytes. Typing that back would
    // make a different name, so the replacement character has to go.
    const problem =
      nameProblem(r.text) ??
      (!nameIsText(r.path) && r.text.includes(REPLACEMENT)
        ? `The name has bytes that are not text, shown as ${REPLACEMENT}. Type the new name without them.`
        : null);
    if (problem) {
      setRenaming((cur) => (cur ? { ...cur, error: problem } : cur));
      return;
    }
    setRenaming((cur) => (cur ? { ...cur, busy: true, error: null } : cur));
    try {
      const to = await renameItem(r.path, r.text);
      if (!alive.current) return;
      setRenaming(null);
      void useOps.getState().refreshUndo();
      showResult([to]);
      latest.current.focusList();
    } catch (e) {
      if (!alive.current) return;
      const err = toWireError(e);
      setRenaming((cur) => (cur ? { ...cur, busy: false, error: editErrorText(err) } : cur));
    }
  }, [cancelRename, showResult]);

  const submitName = useCallback(
    async (name: string) => {
      const kind = naming;
      if (!kind) return;
      const make = kind === "folder" ? createDir : createFile;
      const to = await make(latest.current.folder, name);
      if (!alive.current) return;
      setNaming(null);
      void useOps.getState().refreshUndo();
      showResult([to]);
    },
    [naming, showResult]
  );

  const askDelete = useCallback(() => {
    const list = latest.current.selected();
    if (list.length === 0) return;
    ask({ kind: "delete", items: list.map((e) => ({ path: e.path, name: e.name })) });
  }, [ask]);

  // What dropped items do is in ops/drop-items.ts; what landed in the folder on show is selected
  // once both halves have ended.
  const drop = useCallback(
    async (choice: DropChoice, sources: WirePath[], dest: WirePath) => {
      const here = pathKey(dest) === pathKey(latest.current.folder);
      await dropItems(choice, sources, dest, {
        failed: failAfter,
        landed: here ? showResult : undefined,
      });
    },
    [failAfter, showResult]
  );

  /** Answers the open question: it can only be the permanent delete. */
  const answer = useCallback(() => {
    const q = asking;
    ask(null);
    latest.current.focusList();
    if (q) void useOps.getState().start({ kind: "delete", sources: q.items.map((i) => i.path) });
  }, [asking, ask]);

  const cancelAsk = useCallback(() => {
    ask(null);
    latest.current.focusList();
  }, [ask]);

  const controller = useMemo<FileOpsController>(
    () => ({
      canCreate: () => latest.current.ready(),
      newFolder: () => latest.current.ready() && setNaming("folder"),
      newFile: () => latest.current.ready() && setNaming("file"),
      canRename: () => latest.current.selected().length === 1,
      rename: startRename,
      copy: () => void put("copy"),
      cut: () => void put("cut"),
      paste: () => void paste(),
      trash: () => {
        const list = latest.current.selected();
        if (list.length === 0) return;
        void useOps.getState().start({ kind: "trash", sources: list.map((e) => e.path) });
      },
      askDelete,
    }),
    [startRename, put, paste, askDelete]
  );

  return {
    controller,
    naming,
    closeNaming: () => setNaming(null),
    submitName,
    renaming,
    editRename,
    commitRename,
    cancelRename,
    asking,
    answer,
    cancelAsk,
    drop,
    problems,
    dismissProblem: (id: number) => setProblems((list) => list.filter((p) => p.id !== id)),
    fail,
  };
}

export type FileOps = ReturnType<typeof useFileOps>;
