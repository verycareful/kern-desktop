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

// One folder shown in one tab (design 4.1, 5.1): lists it, watches it under
// the tab's id, and keeps the listing current. The list shown is always the
// listing of the path asked for: a failed or missing folder shows no entries,
// never the previous contents.

export type Phase = "loading" | "ready" | "error" | "gone";

export interface FolderOptions {
  hidden: boolean;
  sortBy: SortBy;
  sortDir: SortDir;
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
  error: null,
  watchError: null,
  gone: null,
});

export interface FolderApi extends Core {
  /** Applies a selection function (from selection.ts) to the current selection. */
  dispatch(op: (sel: Sel, count: number) => Sel): void;
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
            console.error("unwatch_dir failed", e);
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
      void chainUnwatch().then((err) => {
        if (err && alive) setCore((c) => ({ ...c, watchError: err }));
      });
    };

    const startWatch = async () => {
      const previous = await unwatching.current;
      if (!alive) return;
      try {
        await watchDir(tabId, target);
        watching = true;
        watchFailed = false;
        // This effect was cleaned up while the watch was being placed: end it.
        if (!alive) stopWatch();
        else setCore((c) => ({ ...c, watchError: previous }));
      } catch (e) {
        watchFailed = true;
        if (alive) setCore((c) => ({ ...c, watchError: toWireError(e) }));
      }
    };

    const showNone = (patch: Partial<Core>) => {
      rawRef.current = [];
      setCore((c) => ({ ...c, raw: [], entries: [], sel: empty, ...patch }));
    };

    // True when the folder listed. A list that is no longer the latest asked
    // for is dropped, so a slow old answer never replaces a newer one.
    const load = async (): Promise<boolean> => {
      const mine = ++seq;
      try {
        const raw = await listDir(target, hidden.current);
        if (!alive || mine !== seq) return false;
        const entries = order(raw);
        rawRef.current = raw;
        setCore((c) => ({
          ...c,
          phase: "ready",
          raw,
          entries,
          sel: remap(c.sel, c.entries, entries),
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
            if (ev.error) setCore((c) => ({ ...c, watchError: ev.error ?? null }));
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
    const entries = sortEntries(raw, opts.sortBy, opts.sortDir);
    setCore((c) => (c.raw === raw ? { ...c, entries, sel: remap(c.sel, c.entries, entries) } : c));
  }, [opts.sortBy, opts.sortDir]);

  const dispatch = useCallback(
    (op: (sel: Sel, count: number) => Sel) =>
      setCore((c) => ({ ...c, sel: op(c.sel, c.entries.length) })),
    []
  );
  const refresh = useCallback(() => reload.current(), []);

  // For the render in which the path has changed but its effect has not yet
  // run, the state is still the previous folder's: show nothing of it.
  const shown = core.key === folderKey ? core : initial(folderKey);
  return { ...shown, dispatch, refresh };
}
