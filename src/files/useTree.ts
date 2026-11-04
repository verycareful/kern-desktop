// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_DIR_CHANGED,
  EVENT_DIR_GONE,
  displayPath,
  fileIdentity,
  listDir,
  on,
  parent,
  pathKey,
  tabWindow,
  toWireError,
  unwatchDir,
  watchDir,
  type UnlistenFn,
  type WireEntry,
  type WirePath,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { createSorter, type Sorter } from "./sort-async";
import {
  branchPaths,
  closeFolder,
  flatten,
  newModel,
  openFolder,
  setLink,
  updateFolder,
  type Listing,
  type Row,
  type TreeModel,
} from "./tree";

// The folder tree's state: the folders the user expanded, each listed
// lazily when it is opened and watched under a key of its own for as long as it stays open, so a
// change shows and a folder that is closed costs nothing. A watch that cannot be set is said in
// the tree beside the folder, a folder that cannot be listed shows its error in place, and a
// folder that vanished (deleted, unmounted) is closed with a note, never shown stale. A link to
// a folder that leads back to a folder above it is shown as a loop and not opened; one whose identity cannot be told is not opened either, and says why.

export interface TreeNote {
  id: number;
  text: string;
}

export interface TreeApi {
  /** The visible rows, in order. */
  rows: Row[];
  /** Opens a folder (or a link to one) listed in the folder `parentKey`. */
  expand(entry: WireEntry, parentKey: string): void;
  /** Closes the folder `key` and those below it. */
  collapse(key: string): void;
  /** Lists every open folder again. */
  refresh(): void;
  /** What the tree has to say beyond its rows: closed folders, failed watches, failed opens. */
  notes: TreeNote[];
  notify(text: string): void;
  dismissNote(id: number): void;
  /** Whether folder `key` is open. */
  isOpen(key: string): boolean;
}

export interface TreeOptions {
  root: WirePath;
  /** Whether hidden items are listed. */
  hidden: boolean;
  /**
   * Names this tree's watches. The default is the window's label and a random id, so no two trees
   * of the application share a key: the watches live in one registry for all windows, and a
   * collapse in one tree must not end the watch another tree holds on the same folder.
   */
  treeId?: string;
  /**
   * The root is gone: `nearest` is the closest folder above it that lists, or null. The caller
   * decides what the tree is rooted at next; until it does, the root shows its error.
   */
  onRootGone?(nearest: WirePath | null): void;
}

/** The nearest ancestor of `path` that lists, found by walking up with list_dir. */
async function nearestAncestor(path: WirePath): Promise<WirePath | null> {
  for (let p = parent(path); p !== null; p = parent(p)) {
    try {
      await listDir(p, false);
      return p;
    } catch {
      // Not there (or not readable) either: keep climbing.
    }
  }
  return null;
}

interface Controller {
  expand(entry: WireEntry, parentKey: string): void;
  collapse(key: string): void;
  refresh(): void;
  isOpen(key: string): boolean;
}

const NONE: Controller = {
  expand: () => undefined,
  collapse: () => undefined,
  refresh: () => undefined,
  isOpen: () => false,
};

export function useTree(opts: TreeOptions): TreeApi {
  const [own] = useState(() => `${tabWindow()}:${crypto.randomUUID()}`);
  const treeId = opts.treeId ?? own;
  const [model, setModel] = useState<TreeModel>(() => newModel(opts.root));
  const [notes, setNotes] = useState<TreeNote[]>([]);
  const nextNote = useRef(0);
  const ctl = useRef<Controller>(NONE);
  const hidden = useRef(opts.hidden);
  const onRootGone = useRef(opts.onRootGone);
  useEffect(() => {
    onRootGone.current = opts.onRootGone;
  });
  const rootKey = pathKey(opts.root);

  const notify = useCallback((text: string) => {
    setNotes((n) =>
      n.some((x) => x.text === text) ? n : [...n, { id: nextNote.current++, text }]
    );
  }, []);

  useEffect(() => {
    const root = opts.root;
    const prefix = `tree:${treeId}:`;
    const watchKey = (key: string) => `${prefix}${key}`;
    let alive = true;
    let current: TreeModel = newModel(root);
    setModel(current);
    setNotes([]);
    const commit = (f: (m: TreeModel) => TreeModel) => {
      if (!alive) return;
      current = f(current);
      setModel(current);
    };
    const say = (text: string) => alive && notify(text);

    // ---- the watches: one per open folder, each key's calls in order ----
    const chains = new Map<string, Promise<void>>();
    const watching = new Set<string>();
    const chain = (key: string, step: () => Promise<void>) => {
      const next = (chains.get(key) ?? Promise.resolve()).then(step);
      chains.set(key, next);
    };
    const startWatch = (key: string) =>
      chain(key, async () => {
        const node = current.folders.get(key);
        if (!alive || !node || watching.has(key)) return;
        try {
          await watchDir(watchKey(key), node.path);
          watching.add(key);
          // Closed while the watch was being placed: end it again.
          if (!current.folders.has(key)) stopWatch(key);
          else commit((m) => updateFolder(m, key, (n) => ({ ...n, watchError: null })));
        } catch (e) {
          const error = toWireError(e);
          commit((m) => updateFolder(m, key, (n) => ({ ...n, watchError: error })));
        }
      });
    const stopWatch = (key: string) =>
      chain(key, async () => {
        if (!watching.delete(key)) return;
        try {
          await unwatchDir(watchKey(key));
        } catch (e) {
          // The folder is no longer on show, so the note stands beside nothing: it goes in the notes.
          const name = baseName(node(key)?.path ?? root);
          say(`The watch on ${name} did not end: ${errorText(toWireError(e))}`);
        }
      });
    const node = (key: string) => current.folders.get(key);

    // ---- listing ----
    const seq = new Map<string, number>();
    const sorter: Sorter = createSorter();
    /** Closes `key` (and what is below it) because the folder is gone. */
    const vanish = (key: string) => {
      const gone = node(key);
      if (!gone) return;
      const closed = closeFolder(current, key);
      commit(() => closed.model);
      closed.removed.forEach(stopWatch);
      say(`${displayPath(gone.path)} is gone, so it was closed.`);
    };
    const showListing = (key: string, listing: Listing) =>
      commit((m) => updateFolder(m, key, (n) => ({ ...n, listing })));

    const listFolder = async (key: string): Promise<void> => {
      const target = node(key);
      if (!target) return;
      const mine = (seq.get(key) ?? 0) + 1;
      seq.set(key, mine);
      const stale = () => !alive || seq.get(key) !== mine || !current.folders.has(key);
      try {
        const raw = await listDir(target.path, hidden.current);
        if (stale()) return;
        const entries = await sorter.sort(raw, "name", "asc");
        if (stale()) return;
        showListing(key, { state: "ready", entries });
      } catch (e) {
        if (stale()) return;
        const error = toWireError(e);
        if (error.kind !== "NotFound") {
          showListing(key, { state: "error", error });
          return;
        }
        if (key !== current.rootKey) {
          vanish(key);
          return;
        }
        // The root itself: the caller is offered the nearest folder above it.
        showListing(key, { state: "error", error });
        const nearest = await nearestAncestor(root);
        if (alive) onRootGone.current?.(nearest);
      }
    };

    // ---- opening a folder, and the loop check of a link ----
    const open = (entry: WireEntry, parentKey: string) => {
      const key = pathKey(entry.path);
      commit((m) =>
        openFolder(m, key, {
          path: entry.path,
          parent: parentKey,
          listing: { state: "loading" },
          watchError: null,
        })
      );
      startWatch(key);
      void listFolder(key);
    };
    const expand = (entry: WireEntry, parentKey: string) => {
      const key = pathKey(entry.path);
      if (current.folders.has(key) || !current.folders.has(parentKey)) return;
      if (entry.kind !== "symlink") {
        open(entry, parentKey);
        return;
      }
      // A link to a folder: opened only when it does not lead back to a folder above it.
      commit((m) => setLink(m, key, { kind: "checking" }));
      const branch = branchPaths(current, parentKey);
      void fileIdentity([...branch, entry.path]).then(
        (ids) => {
          if (!alive) return;
          const mine = ids[ids.length - 1];
          const failed = ids.find((i) => i.state === "failed");
          if (failed?.state === "failed") {
            commit((m) => setLink(m, key, { kind: "unknown", error: failed.error }));
            return;
          }
          const same = (a: (typeof ids)[number] | undefined, b: (typeof ids)[number]) =>
            a?.state === "known" && b.state === "known" && a.dev === b.dev && a.ino === b.ino;
          if (mine && ids.slice(0, -1).some((above) => same(above, mine))) {
            commit((m) => setLink(m, key, { kind: "loop" }));
            return;
          }
          commit((m) => setLink(m, key, null));
          open(entry, parentKey);
        },
        (e: unknown) => commit((m) => setLink(m, key, { kind: "unknown", error: toWireError(e) }))
      );
    };
    const collapse = (key: string) => {
      const closed = closeFolder(current, key);
      if (closed.removed.length === 0) return;
      commit(() => closed.model);
      closed.removed.forEach((k) => {
        seq.set(k, (seq.get(k) ?? 0) + 1);
        stopWatch(k);
      });
    };
    const refresh = () => [...current.folders.keys()].forEach((k) => void listFolder(k));
    ctl.current = { expand, collapse, refresh, isOpen: (k) => current.folders.has(k) };

    // ---- changes ----
    const unlisten: UnlistenFn[] = [];
    const folderOf = (eventKey: string) =>
      eventKey.startsWith(prefix) ? eventKey.slice(prefix.length) : null;
    (async () => {
      // Subscribed before the first listing, so a change between the listing and the watch is not missed.
      try {
        const [changed, gone] = await Promise.all([
          on(EVENT_DIR_CHANGED, (ev) => {
            const key = folderOf(ev.key);
            if (key !== null && current.folders.has(key)) void listFolder(key);
          }),
          on(EVENT_DIR_GONE, (ev) => {
            const key = folderOf(ev.key);
            if (key === null || !current.folders.has(key)) return;
            // The watch is over either way; the folder may be back (replaced in place).
            watching.delete(key);
            if (ev.error) {
              const error = ev.error;
              commit((m) => updateFolder(m, key, (n) => ({ ...n, watchError: error })));
            }
            void listFolder(key).then(() => {
              if (alive && !ev.error && current.folders.has(key)) startWatch(key);
            });
          }),
        ]);
        if (alive) unlisten.push(changed, gone);
        else {
          changed();
          gone();
        }
      } catch (e) {
        say(`Changes in folders will not show: ${errorText(toWireError(e))}`);
      }
      if (!alive) return;
      startWatch(current.rootKey);
      await listFolder(current.rootKey);
    })();

    return () => {
      alive = false;
      ctl.current = NONE;
      unlisten.forEach((u) => u());
      sorter.dispose();
      // Every watch this tree placed ends with it; failures have nowhere to be shown.
      for (const key of [...watching]) {
        void unwatchDir(watchKey(key)).catch((e: unknown) =>
          console.error(`unwatch_dir failed for tree folder ${key}`, e)
        );
      }
      watching.clear();
    };
    // The tree is identified by its root and its id; `notify` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey, treeId]);

  // Hidden items shown or hidden: every open folder is listed again; the watches stay.
  const shownHidden = useRef(opts.hidden);
  useEffect(() => {
    hidden.current = opts.hidden;
    if (shownHidden.current === opts.hidden) return;
    shownHidden.current = opts.hidden;
    ctl.current.refresh();
  }, [opts.hidden]);

  const rows = useMemo(() => flatten(model), [model]);
  return {
    rows,
    expand: useCallback((e: WireEntry, p: string) => ctl.current.expand(e, p), []),
    collapse: useCallback((k: string) => ctl.current.collapse(k), []),
    refresh: useCallback(() => ctl.current.refresh(), []),
    notes,
    notify,
    dismissNote: useCallback((id: number) => setNotes((n) => n.filter((x) => x.id !== id)), []),
    isOpen: useCallback((k: string) => ctl.current.isOpen(k), []),
  };
}
