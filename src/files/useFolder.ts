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
  /** In phase "gone": the nearest ancestor that still lists, or null if none does. */
  gone: { ancestor: WirePath | null } | null;
}

const INITIAL: Core = {
  phase: "loading",
  raw: [],
  entries: [],
  sel: empty,
  error: null,
  watchError: null,
  gone: null,
};

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
  const [core, setCore] = useState<Core>(INITIAL);
  const pathK = pathKey(path);

  // The effects below read these without restarting when they change.
  const hidden = useRef(opts.hidden);
  const sort = useRef({ by: opts.sortBy, dir: opts.sortDir });
  useLayoutEffect(() => {
    hidden.current = opts.hidden;
    sort.current = { by: opts.sortBy, dir: opts.sortDir };
  });
  const reload = useRef<() => void>(() => undefined);
  // The unwatch of the previous folder, so the next watch is placed only after
  // it: both use the tab's key, and the backend must not see them swapped.
  const unwatching = useRef<Promise<WireError | null>>(Promise.resolve(null));

  useEffect(() => {
    const target = path;
    let alive = true;
    let seq = 0;
    const unlisten: UnlistenFn[] = [];

    const order = (raw: WireEntry[]) => sortEntries(raw, sort.current.by, sort.current.dir);

    const startWatch = async () => {
      try {
        await watchDir(tabId, target);
        if (alive) setCore((c) => ({ ...c, watchError: null }));
      } catch (e) {
        if (alive) setCore((c) => ({ ...c, watchError: toWireError(e) }));
      }
    };

    // True when the folder listed. A list that is no longer the latest asked
    // for is dropped, so a slow old answer never replaces a newer one.
    const load = async (): Promise<boolean> => {
      const mine = ++seq;
      try {
        const raw = await listDir(target, hidden.current);
        if (!alive || mine !== seq) return false;
        setCore((c) => {
          const entries = order(raw);
          return {
            ...c,
            phase: "ready",
            raw,
            entries,
            sel: remap(c.sel, c.entries, entries),
            error: null,
            gone: null,
          };
        });
        return true;
      } catch (e) {
        if (!alive || mine !== seq) return false;
        const error = toWireError(e);
        if (error.kind === "NotFound") {
          unwatchDir(tabId).catch((u: unknown) => {
            if (alive) setCore((c) => ({ ...c, watchError: toWireError(u) }));
          });
          const ancestor = await nearestAncestor(target);
          if (!alive || mine !== seq) return false;
          setCore((c) => ({
            ...c,
            phase: "gone",
            raw: [],
            entries: [],
            sel: empty,
            error: null,
            gone: { ancestor },
          }));
        } else {
          setCore((c) => ({
            ...c,
            phase: "error",
            raw: [],
            entries: [],
            sel: empty,
            error,
            gone: null,
          }));
        }
        return false;
      }
    };
    reload.current = () => void load();

    setCore(INITIAL);
    (async () => {
      // Subscribe first, so a change between the listing and the watch is not missed.
      try {
        const [changed, gone] = await Promise.all([
          on(EVENT_DIR_CHANGED, (ev) => {
            if (ev.key === tabId) void load();
          }),
          on(EVENT_DIR_GONE, async (ev) => {
            if (ev.key !== tabId) return;
            // The folder may be back (replaced in place), or the watch alone may
            // have failed: list again to find out, and watch again if it is there.
            if (ev.error) setCore((c) => ({ ...c, watchError: ev.error ?? null }));
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
      const previous = await unwatching.current;
      if (!alive) return;
      if (previous) setCore((c) => ({ ...c, watchError: previous }));
      await startWatch();
      if (alive) await load();
    })();

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
      reload.current = () => undefined;
      unwatching.current = unwatchDir(tabId).then(
        () => null,
        (e: unknown) => {
          console.error("unwatch_dir failed", e);
          return toWireError(e);
        }
      );
    };
    // The folder is identified by its path key, not the identity of the path object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, pathK]);

  // Showing or hiding hidden files lists the same folder again; the watch is unchanged.
  const firstHidden = useRef(true);
  useEffect(() => {
    if (firstHidden.current) {
      firstHidden.current = false;
      return;
    }
    reload.current();
  }, [opts.hidden]);

  // A new sort order re-sorts what is already listed.
  useEffect(() => {
    setCore((c) => {
      if (c.raw.length === 0) return c;
      const entries = sortEntries(c.raw, opts.sortBy, opts.sortDir);
      return { ...c, entries, sel: remap(c.sel, c.entries, entries) };
    });
  }, [opts.sortBy, opts.sortDir]);

  const dispatch = useCallback(
    (op: (sel: Sel, count: number) => Sel) =>
      setCore((c) => ({ ...c, sel: op(c.sel, c.entries.length) })),
    []
  );
  const refresh = useCallback(() => reload.current(), []);

  return { ...core, dispatch, refresh };
}
