// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_PINS_CHANGED,
  EVENT_RECENTS_CHANGED,
  mimeOf,
  on,
  pathKey,
  pin,
  pinsGet,
  pinsReorder,
  prune,
  toWireError,
  unpin,
  type CorruptReport,
  type Pins,
  type RecentEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { openFiles } from "../files/open-entries";
import { errorText } from "../ops/error-text";
import { baseName, namesText } from "../ops/labels";
import { useStoreErrors } from "../store/store-errors";
import { showFolder } from "./place-nav";

// Design 4.2: the pins and recents of the right-hand panel, kept by the
// backend (store_cmds.rs) and followed through its events, so every window
// and every change (a pin from the folder view, a document opened) shows at
// once. Entries whose target is gone are pruned when the panel appears, when
// the window regains focus and when opening one fails. Nothing goes wrong
// quietly: a failure, an entry that could not be checked, a pin removed
// because its target is gone and an unreadable pins or recents file each
// leave a notice in the panel until it is dismissed. A recent entry removed
// because its file is gone leaves none: a file deleted is the usual reason,
// and the user did not choose the entry the way they chose a pin.
//
// The lists come from three places: the events, the answers of pin, unpin and
// pins_reorder, and the answer of prune. Events arrive in the order the backend
// changed the lists, so they are always applied; an answer is applied only if
// no event for that list arrived while it was awaited, since that event
// describes the list at the time of the change or later.

/** The MIME type the backend gives a folder (kernkraft-xdg-apps, through links). */
const FOLDER_MIME = "inode/directory";

/** The files of the backend's store that this panel reports on (store.rs). */
export const PANEL_FILES = ["pins.json", "recents.json"];

export type EntryKind = "folder" | "file";
export type EntryList = "pinned" | "recent";

export interface Notice {
  id: number;
  text: string;
}

interface PinnedRecentState {
  pins: WirePath[] | null;
  recents: RecentEntry[] | null;
  /** What each listed path is, by path key, once looked up; for its icon only. */
  kinds: Record<string, EntryKind>;
  /** Why a path's kind could not be looked up, by path key; shown on its row. */
  kindErrors: Record<string, string>;
  loadError: WireError | null;
  notices: Notice[];
  /** The entry a menu was opened on. */
  current: { list: EntryList; path: WirePath } | null;
  /**
   * Follows the backend's events and prunes; the returned function stops following. Every
   * follower shares one subscription, which ends with the last. With `prune: false` the lists
   * are read, not pruned: the window follows as long as it is open, the panel prunes when shown.
   */
  follow(opts?: { prune?: boolean }): Promise<() => void>;
  /**
   * Drops entries whose target is gone. Calls made meanwhile share one prune; with `fresh`, a
   * call made while one runs waits for it and then prunes again, so the targets are checked
   * after the call.
   */
  prune(fresh?: boolean): Promise<void>;
  /**
   * Pins each path; true when all were pinned. A failure is said through `say`, a panel notice
   * when none is given (a document tab, with the panel folded away, gives the status bar).
   */
  pinPaths(paths: readonly WirePath[], say?: (text: string) => void): Promise<boolean>;
  /** As pinPaths, for one unpin. */
  unpin(path: WirePath, say?: (text: string) => void): Promise<boolean>;
  /** Puts the pins in this order. */
  reorder(paths: readonly WirePath[]): Promise<void>;
  /** Moves a pin one place up (-1) or down (1). */
  shift(path: WirePath, by: -1 | 1): Promise<void>;
  /** A folder shows in the current folder tab; a file goes to the open command (design 4.2). */
  open(path: WirePath): Promise<void>;
  setCurrent(current: { list: EntryList; path: WirePath } | null): void;
  /** Leaves a notice, unless one with the same text is already shown. */
  notify(text: string): void;
  dismiss(id: number): void;
  reset(): void;
}

let nextNotice = 1;
let pruning: Promise<void> | null = null;
/** Counts the events of each list, so an answer older than an event does not replace what it said. */
const events = { pins: 0, recents: 0 };
/** The paths whose kind is being looked up. */
const looking = new Set<string>();
/** The one subscription every follower shares, and how many follow it. */
let shared: { stop: Promise<() => void>; followers: number } | null = null;
/** How many of the store-error reports have been turned into notices. */
let reportsSeen = 0;
/** The failed take last turned into a notice. */
let lastError: WireError | null = null;
/** Bumped by reset, so work begun before it does not write into the fresh state. */
let epoch = 0;

const initial = {
  pins: null,
  recents: null,
  kinds: {},
  kindErrors: {},
  loadError: null,
  notices: [],
  current: null,
};

export const usePinnedRecent = create<PinnedRecentState>()((set, get) => {
  const fail = (what: string, e: unknown) => get().notify(`${what}: ${errorText(toWireError(e))}`);

  /** Applies the pins an answer gave, if no pins event arrived since `seen`. */
  const answerPins = (value: Pins, seen: number) => {
    if (events.pins !== seen) return;
    set({ pins: value.entries });
    lookKinds();
  };

  /** Looks up what the listed paths are that are not known yet. */
  const lookKinds = () => {
    const { pins, recents, kinds } = get();
    const paths = [...(pins ?? []), ...(recents ?? []).map((r) => r.path)];
    const mine = epoch;
    for (const p of paths) {
      const key = pathKey(p);
      if (key in kinds || looking.has(key)) continue;
      looking.add(key);
      mimeOf(p).then(
        (m) => {
          looking.delete(key);
          if (mine !== epoch) return;
          const kind: EntryKind = m.mime === FOLDER_MIME ? "folder" : "file";
          set((s) => {
            const kindErrors = { ...s.kindErrors };
            delete kindErrors[key];
            return { kinds: { ...s.kinds, [key]: kind }, kindErrors };
          });
        },
        (e: unknown) => {
          looking.delete(key);
          if (mine !== epoch) return;
          set((s) => ({ kindErrors: { ...s.kindErrors, [key]: errorText(toWireError(e)) } }));
        }
      );
    }
  };

  /** Notices for the reports of pins.json and recents.json not shown yet, and for a failed take. */
  const showReports = (r: { reports: CorruptReport[]; error: WireError | null }) => {
    const fresh = r.reports.slice(reportsSeen);
    reportsSeen = r.reports.length;
    const errorSeen = lastError;
    lastError = r.error;
    for (const report of fresh.filter((x) => PANEL_FILES.includes(x.file))) {
      get().notify(corruptText(report));
    }
    if (r.error && r.error !== errorSeen) {
      get().notify(
        `The reports of unreadable settings files could not be read: ${errorText(r.error)}`
      );
    }
  };

  /** Subscribes to the events and the store-error reports; the returned function ends it. */
  const subscribe = async (): Promise<() => void> => {
    const mine = epoch;
    const subscribed = await Promise.allSettled([
      on(EVENT_PINS_CHANGED, (p) => {
        events.pins++;
        set({ pins: p.entries });
        lookKinds();
      }),
      on(EVENT_RECENTS_CHANGED, (r) => {
        events.recents++;
        set({ recents: r.entries });
        lookKinds();
      }),
    ]);
    const offs = subscribed.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const refused = subscribed.find((r) => r.status === "rejected");
    // The lists are still read, and the answers to Kern's own changes still show.
    if (refused && mine === epoch) {
      fail(
        "Pinned and Recent will not follow changes made elsewhere",
        (refused as PromiseRejectedResult).reason
      );
    }
    const unwatchReports = useStoreErrors.subscribe(showReports);
    const stopReports = await useStoreErrors.getState().follow();
    const stop = () => {
      offs.forEach((off) => off());
      unwatchReports();
      stopReports();
    };
    if (mine !== epoch) {
      stop();
      return () => undefined;
    }
    showReports(useStoreErrors.getState());
    return stop;
  };

  return {
    ...initial,
    async follow(opts) {
      const mine = epoch;
      const s = (shared ??= { stop: subscribe(), followers: 0 });
      s.followers++;
      const stop = await s.stop;
      if (mine === epoch) {
        if (opts?.prune !== false) await get().prune();
        else if (get().pins === null) {
          const seen = events.pins;
          try {
            answerPins(await pinsGet(), seen);
          } catch (e) {
            if (mine === epoch && get().pins === null) set({ loadError: toWireError(e) });
          }
        }
      }
      let left = false;
      return () => {
        if (left) return;
        left = true;
        s.followers--;
        if (s.followers > 0) return;
        if (shared === s) shared = null;
        stop();
      };
    },
    async prune(fresh = false) {
      if (fresh && pruning) await pruning;
      pruning ??= (async () => {
        const mine = epoch;
        const seen = { ...events };
        try {
          const report = await prune();
          if (mine !== epoch) return;
          set((s) => ({
            loadError: null,
            ...(seen.pins === events.pins || s.pins === null ? { pins: report.pins.entries } : {}),
            ...(seen.recents === events.recents || s.recents === null
              ? { recents: report.recents.entries }
              : {}),
          }));
          if (report.pins_removed.length > 0) {
            get().notify(
              `Removed from Pinned, since it no longer exists: ${namesText(report.pins_removed.map(baseName))}`
            );
          }
          for (const e of report.errors) {
            get().notify(
              `Kern could not check whether ${baseName(e.path)} still exists: ${errorText(e.error)}`
            );
          }
          lookKinds();
        } catch (e) {
          if (mine !== epoch) return;
          if (get().pins === null) set({ loadError: toWireError(e) });
          else fail("Pinned and Recent could not be checked", e);
        } finally {
          pruning = null;
        }
      })();
      return pruning;
    },
    async pinPaths(paths, say = get().notify) {
      let all = true;
      for (const p of paths) {
        const seen = events.pins;
        try {
          answerPins(await pin(p), seen);
        } catch (e) {
          all = false;
          say(`${baseName(p)} could not be pinned: ${errorText(toWireError(e))}`);
        }
      }
      return all;
    },
    async unpin(path, say = get().notify) {
      const seen = events.pins;
      try {
        answerPins(await unpin(path), seen);
        return true;
      } catch (e) {
        say(`${baseName(path)} could not be unpinned: ${errorText(toWireError(e))}`);
        return false;
      }
    },
    async reorder(paths) {
      const seen = events.pins;
      try {
        answerPins(await pinsReorder([...paths]), seen);
      } catch (e) {
        fail("The pins could not be reordered", e);
      }
    },
    async shift(path, by) {
      const pins = get().pins ?? [];
      const from = pins.findIndex((p) => pathKey(p) === pathKey(path));
      const to = from + by;
      if (from < 0 || to < 0 || to >= pins.length) return;
      await get().reorder(moveItem(pins, from, to));
    },
    async open(path) {
      let mime: string;
      try {
        mime = (await mimeOf(path)).mime;
      } catch (e) {
        fail(`${baseName(path)} could not be opened`, e);
        return;
      }
      if (mime === FOLDER_MIME) {
        showFolder(path);
        return;
      }
      const errors = await openFiles([path], false);
      if (errors.length === 0) return;
      for (const e of errors) {
        get().notify(`${baseName(path)} could not be opened: ${errorText(e)}`);
      }
      // Design 4.2: an entry whose open failed is pruned, if its target is gone. A prune that
      // began before the failure may have found it still there, so this one starts after it.
      await get().prune(true);
    },
    setCurrent(current) {
      set({ current });
    },
    notify(text) {
      set((s) =>
        s.notices.some((n) => n.text === text)
          ? s
          : { notices: [...s.notices, { id: nextNotice++, text }] }
      );
    },
    dismiss(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
    reset() {
      epoch++;
      pruning = null;
      shared = null;
      events.pins = 0;
      events.recents = 0;
      looking.clear();
      reportsSeen = 0;
      lastError = null;
      set(initial);
    },
  };
});

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  if (item === undefined) return out;
  out.splice(to, 0, item);
  return out;
}

function corruptText(r: CorruptReport): string {
  const where = r.moved_to
    ? `It was kept as ${baseName(r.moved_to)} and Kern started a fresh one`
    : "Kern left it in place";
  const field = r.field ? ` (the ${r.field} entry)` : "";
  return `${r.file}${field} could not be read: ${r.reason}. ${where}.`;
}
