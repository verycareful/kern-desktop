// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  EVENT_DIR_CHANGED,
  EVENT_DIR_GONE,
  listDir,
  on,
  parent,
  pathKey,
  toWireError,
  unwatchDir,
  watchDir,
  type UnlistenFn,
  type WireEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { empty, type Sel } from "./selection";
import { sortEntries, type SortBy, type SortDir } from "./sort";
import { SORT_IN_WORKER_ABOVE, createSorter, type Sorter } from "./sort-async";

// One folder shown in one tab (design 4.1, 5.1): lists it, watches it under
// the tab's id, and keeps the listing current. The list shown is always the
// listing of the path asked for: a failed or missing folder shows no entries,
// never the previous contents.

export type Phase = "loading" | "ready" | "error" | "gone";

/** A selection kept by path (R56), to put back on the first listing of `pathKey`. */
export interface SeedSel {
  pathKey: string;
  selected: readonly string[];
  anchor: string | null;
  cursor: string | null;
}

export interface FolderOptions {
  hidden: boolean;
  sortBy: SortBy;
  sortDir: SortDir;
  /**
   * Read when the view mounts. It is applied to the first listing, only if that
   * is the folder it was taken in, and then dropped: a later listing, or a
   * listing of another folder, never sees it.
   */
  seed?: SeedSel | null;
}

interface Core {
  /** Which folder (tab and path) this state is the listing of. */
  key: string;
  phase: Phase;
  /** The listing as sent. */
  raw: WireEntry[];
  /** The listing in display order; `sel` indexes this. */
  entries: WireEntry[];
  sel: Sel;
  /** True while a large listing is being sorted in the worker. */
  sorting: boolean;
  /**
   * Why the sort failed (the worker); the entries are then in the order the
   * folder gave them. Cleared by the next sort that works.
   */
  sortError: WireError | null;
  /** Why the listing failed, in phase "error". */
  error: WireError | null;
  /** Why live updates are not running, if they are not; the listing still shows. */
  watchError: WireError | null;
  /**
   * In phase "gone": the nearest ancestor that still lists, or null if none
   * does (yet, while `searching`).
   */
  gone: { ancestor: WirePath | null; searching: boolean } | null;
}

const initial = (key: string): Core => ({
  key,
  phase: "loading",
  raw: [],
  entries: [],
  sel: empty,
  sorting: false,
  sortError: null,
  error: null,
  watchError: null,
  gone: null,
});

export interface FolderApi extends Core {
  /** Applies a selection function (from selection.ts) to the current selection. */
  dispatch(op: (sel: Sel, count: number) => Sel): void;
  /** Selects the entries with these path keys (those listed; the first becomes the cursor). */
  selectKeys(keys: readonly string[]): void;
  /** Lists the folder again now. */
  refresh(): void;
}

/**
 * Carries a selection over to a new ordering of the entries, by path: an item
 * that is still there stays selected wherever it moved to; one that went away
 * leaves the selection.
 */
function remap(sel: Sel, from: readonly WireEntry[], to: readonly WireEntry[]): Sel {
  if (sel.selected.size === 0 && sel.anchor === null && sel.cursor === null) return sel;
  const at = new Map<string, number>();
  to.forEach((e, i) => at.set(pathKey(e.path), i));
  const index = (i: number | null): number | null => {
    const e = i === null ? undefined : from[i];
    return e === undefined ? null : (at.get(pathKey(e.path)) ?? null);
  };
  const selected = new Set<number>();
  for (const i of sel.selected) {
    const j = index(i);
    if (j !== null) selected.add(j);
  }
  return { selected, anchor: index(sel.anchor), cursor: index(sel.cursor) };
}

/** The selection `seed` names, as indices into `entries`; what is no longer listed is left out. */
function seedSel(seed: SeedSel, entries: readonly WireEntry[]): Sel {
  const at = new Map<string, number>();
  entries.forEach((e, i) => at.set(pathKey(e.path), i));
  const selected = new Set<number>();
  for (const k of seed.selected) {
    const i = at.get(k);
    if (i !== undefined) selected.add(i);
  }
  const one = (k: string | null) => (k === null ? null : (at.get(k) ?? null));
  return { selected, anchor: one(seed.anchor), cursor: one(seed.cursor) };
}

/**
 * The nearest ancestor of `path` that lists, found by walking up with
 * list_dir (the one command that answers "is this readable folder there").
 */
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

export function useFolder(tabId: string, path: WirePath, opts: FolderOptions): FolderApi {
  const [core, setCore] = useState<Core>(() => initial(`${tabId}\n${pathKey(path)}`));
  const pathK = pathKey(path);
  const folderKey = `${tabId}\n${pathK}`;

  // The effects below read these without restarting when they change.
  const hidden = useRef(opts.hidden);
  const sort = useRef({ by: opts.sortBy, dir: opts.sortDir });
  useLayoutEffect(() => {
    hidden.current = opts.hidden;
    sort.current = { by: opts.sortBy, dir: opts.sortDir };
  });
  // The listing as sent, for re-sorting outside a state updater (React may run an updater twice).
  const rawRef = useRef<WireEntry[]>([]);
  // Large folders are sorted in a worker, created at the first need and ended with the view.
  const sorter = useRef<Sorter | null>(null);
  const getSorter = () => (sorter.current ??= createSorter());
  useEffect(
    () => () => {
      sorter.current?.dispose();
      sorter.current = null;
    },
    []
  );
  const seed = useRef(opts.seed ?? null);
  const resortSeq = useRef(0);
  const reload = useRef<() => void>(() => undefined);
  // The last unwatch sent for this tab's key. Every watch and unwatch of the
  // key is chained after it, so the backend sees them in the order they were
  // meant (a late unwatch of the old folder must not remove the new watch).
  const unwatching = useRef<Promise<WireError | null>>(Promise.resolve(null));

  useEffect(() => {
    const target = path;
    let alive = true;
    let seq = 0;
    let watching = false;
    let watchFailed = false;
    const unlisten: UnlistenFn[] = [];

    const order = (raw: WireEntry[]) => sortEntries(raw, sort.current.by, sort.current.dir);

    const chainUnwatch = (): Promise<WireError | null> => {
      const next = unwatching.current.then(() =>
        unwatchDir(tabId).then(
          () => null,
          (e: unknown) => {
            console.error(`unwatch_dir failed for the view of tab ${tabId}`, e);
            return toWireError(e);
          }
        )
      );
      unwatching.current = next;
      return next;
    };
    // Only a watch that is running is stopped: the backend has nothing to stop otherwise.
    const stopWatch = () => {
      if (!watching) return;
      watching = false;
      // A failure is logged by chainUnwatch: the folder this watch was for is no
      // longer on show, so there is nothing for the error to be shown beside.
      void chainUnwatch();
    };

    const startWatch = async () => {
      await unwatching.current;
      if (!alive) return;
      try {
        await watchDir(tabId, target);
        watching = true;
        watchFailed = false;
        // This effect was cleaned up while the watch was being placed: end it.
        if (!alive) stopWatch();
        else setCore((c) => ({ ...c, watchError: null }));
      } catch (e) {
        watchFailed = true;
        if (alive) setCore((c) => ({ ...c, watchError: toWireError(e) }));
      }
    };

    const showNone = (patch: Partial<Core>) => {
      rawRef.current = [];
      setCore((c) => ({
        ...c,
        raw: [],
        entries: [],
        sel: empty,
        sorting: false,
        sortError: null,
        ...patch,
      }));
    };

    // True when the folder listed. A list that is no longer the latest asked
    // for is dropped, so a slow old answer never replaces a newer one.
    const load = async (): Promise<boolean> => {
      const mine = ++seq;
      try {
        const raw = await listDir(target, hidden.current);
        if (!alive || mine !== seq) return false;
        let entries: WireEntry[];
        let sortError: WireError | null = null;
        if (raw.length <= SORT_IN_WORKER_ABOVE) entries = order(raw);
        else {
          setCore((c) => ({ ...c, sorting: true }));
          try {
            // The sort may be changed while the worker works: sort again for the new order.
            let used: typeof sort.current;
            do {
              used = sort.current;
              entries = await getSorter().sort(raw, used.by, used.dir);
            } while (
              alive &&
              mine === seq &&
              (used.by !== sort.current.by || used.dir !== sort.current.dir)
            );
          } catch (e) {
            if (!alive || mine !== seq) return false;
            // Not sorted by the main thread instead: that would freeze the page for the
            // very folders the worker is for, and a quiet substitute is what the rules rule out.
            // The list is shown in the folder's own order, with the reason.
            entries = raw;
            sortError = toWireError(e);
          }
          if (!alive || mine !== seq) return false;
        }
        rawRef.current = raw;
        // The kept selection goes onto the first listing, if it is of the folder it was kept in.
        const kept = seed.current;
        seed.current = null;
        const seeded = kept !== null && kept.pathKey === pathK ? seedSel(kept, entries) : null;
        setCore((c) => ({
          ...c,
          phase: "ready",
          raw,
          entries,
          sel: seeded ?? remap(c.sel, c.entries, entries),
          sorting: false,
          sortError,
          error: null,
          gone: null,
        }));
        return true;
      } catch (e) {
        if (!alive || mine !== seq) return false;
        const error = toWireError(e);
        if (error.kind === "NotFound") {
          // Known to be missing now; the search for a folder to offer follows.
          stopWatch();
          showNone({ phase: "gone", error: null, gone: { ancestor: null, searching: true } });
          const ancestor = await nearestAncestor(target);
          if (!alive || mine !== seq) return false;
          setCore((c) => (c.phase === "gone" ? { ...c, gone: { ancestor, searching: false } } : c));
        } else {
          showNone({ phase: "error", error, gone: null });
        }
        return false;
      }
    };
    reload.current = () => {
      if (watchFailed) void startWatch();
      void load();
    };

    setCore(initial(folderKey));
    rawRef.current = [];
    (async () => {
      // Subscribe first, so a change between the listing and the watch is not missed.
      try {
        const [changed, gone] = await Promise.all([
          on(EVENT_DIR_CHANGED, (ev) => {
            if (ev.key === tabId) void load();
          }),
          on(EVENT_DIR_GONE, async (ev) => {
            if (ev.key !== tabId) return;
            // The old listing is not shown for another moment.
            showNone({ phase: "loading", error: null, gone: null });
            if (ev.error) {
              // The watch ended on its own: F5 puts it back.
              watching = false;
              watchFailed = true;
              setCore((c) => ({ ...c, watchError: ev.error ?? null }));
            }
            // The folder may be back (replaced in place), or the watch alone may
            // have failed: list again to find out, and watch again if it is there.
            const listed = await load();
            if (listed && !ev.error && alive) await startWatch();
          }),
        ]);
        if (alive) unlisten.push(changed, gone);
        else {
          changed();
          gone();
        }
      } catch (e) {
        if (alive) setCore((c) => ({ ...c, watchError: toWireError(e) }));
      }
      await startWatch();
      if (alive) await load();
    })();

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
      reload.current = () => undefined;
      stopWatch();
    };
    // The folder is identified by its path key, not the identity of the path object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, pathK]);

  // Showing or hiding hidden files lists the same folder again; the watch is unchanged.
  const shownHidden = useRef(opts.hidden);
  useEffect(() => {
    if (shownHidden.current === opts.hidden) return;
    shownHidden.current = opts.hidden;
    reload.current();
  }, [opts.hidden]);

  // A new sort order re-sorts what is already listed.
  useEffect(() => {
    const raw = rawRef.current;
    if (raw.length === 0) return;
    const stamp = ++resortSeq.current;
    const apply = (entries: WireEntry[], sortError: WireError | null) =>
      setCore((c) =>
        c.raw === raw && stamp === resortSeq.current
          ? { ...c, entries, sel: remap(c.sel, c.entries, entries), sorting: false, sortError }
          : c
      );
    if (raw.length <= SORT_IN_WORKER_ABOVE) {
      apply(sortEntries(raw, opts.sortBy, opts.sortDir), null);
      return;
    }
    setCore((c) => (c.raw === raw ? { ...c, sorting: true } : c));
    getSorter()
      .sort(raw, opts.sortBy, opts.sortDir)
      .then(
        (entries) => apply(entries, null),
        (e: unknown) => apply(raw, toWireError(e))
      );
  }, [opts.sortBy, opts.sortDir]);

  const dispatch = useCallback(
    (op: (sel: Sel, count: number) => Sel) =>
      setCore((c) => ({ ...c, sel: op(c.sel, c.entries.length) })),
    []
  );
  const selectKeys = useCallback(
    (keys: readonly string[]) =>
      setCore((c) => ({
        ...c,
        sel: seedSel(
          { pathKey: "", selected: keys, anchor: keys[0] ?? null, cursor: keys[0] ?? null },
          c.entries
        ),
      })),
    []
  );
  const refresh = useCallback(() => reload.current(), []);

  // For the render in which the path has changed but its effect has not yet
  // run, the state is still the previous folder's: show nothing of it.
  const shown = core.key === folderKey ? core : initial(folderKey);
  return { ...shown, dispatch, selectKeys, refresh };
}
