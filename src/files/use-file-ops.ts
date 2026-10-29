// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { baseName, itemsText, namesText } from "../ops/labels";
import { nameIsText, nameProblem } from "../ops/names";
import { useOps } from "../ops/useOps";
import type { FolderController } from "./folder-controller";

// The file operations of one folder view (design 5.1, 5.7, 5.8): create,
// rename, copy, cut, paste, trash, delete for good, and what is dropped on the
// folder. Every one of them acts on what the view hands over as selected, and
// on nothing else: an item that is only outlined is never touched. A question
// (delete for good, copy or move a drop) is frozen when it is asked: it names
// the items it was asked about, and a selection that changes while it is open
// does not change what the answer does. Whatever fails is kept in `problems`
// and shown by the view until it is dismissed.

/** A question waiting for an answer, with what it is about. */
export type Question =
  | { kind: "delete"; items: { path: WirePath; name: string }[] }
  | { kind: "drop"; sources: WirePath[]; dest: WirePath; destName: string; names: string };

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

  const [naming, setNaming] = useState<"folder" | "file" | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const renamingNow = useRef<RenameState | null>(null);
  useEffect(() => {
    renamingNow.current = renaming;
  });
  const [asking, setAsking] = useState<Question | null>(null);
  const [problems, setProblems] = useState<{ id: number; error: WireError }[]>([]);
  const nextProblem = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (!alive.current) return;
    const error = toWireError(e);
    setProblems((list) => [...list, { id: nextProblem.current++, error }]);
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
        onEnd: (end) => showDone(end.report),
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
      setRenaming((cur) =>
        cur ? { ...cur, busy: false, error: `${err.kind}: ${err.message}` } : cur
      );
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
    setAsking({ kind: "delete", items: list.map((e) => ({ path: e.path, name: e.name })) });
  }, []);

  const askDrop = useCallback((sources: WirePath[], dest: WirePath) => {
    setAsking({
      kind: "drop",
      sources,
      dest,
      destName: baseName(dest),
      names: namesText(sources.map(baseName)),
    });
  }, []);

  const drop = useCallback(
    (choice: "copy" | "move", sources: WirePath[], dest: WirePath) => {
      const here = pathKey(dest) === pathKey(latest.current.folder);
      void useOps.getState().start({
        kind: choice,
        sources,
        dest,
        onEnd: (end) => here && showDone(end.report),
      });
    },
    [showDone]
  );

  /** Answers the open question; `alternate` is the second button of a drop (copy). */
  const answer = useCallback(
    (alternate: boolean) => {
      const q = asking;
      setAsking(null);
      latest.current.focusList();
      if (!q) return;
      if (q.kind === "delete") {
        void useOps.getState().start({ kind: "delete", sources: q.items.map((i) => i.path) });
      } else {
        drop(alternate ? "copy" : "move", q.sources, q.dest);
      }
    },
    [asking, drop]
  );

  const cancelAsk = useCallback(() => {
    setAsking(null);
    latest.current.focusList();
  }, []);

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
    askDrop,
    drop,
    problems,
    dismissProblem: (id: number) => setProblems((list) => list.filter((p) => p.id !== id)),
    fail,
  };
}

export type FileOps = ReturnType<typeof useFileOps>;
