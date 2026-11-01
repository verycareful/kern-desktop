// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_PINS_CHANGED,
  EVENT_RECENTS_CHANGED,
  EVENT_STORE_ERROR,
  mimeOf,
  on,
  pathKey,
  pin,
  pinsReorder,
  prune,
  storeErrorsTake,
  toWireError,
  unpin,
  type CorruptReport,
  type RecentEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { openFiles } from "../files/open-entries";
import { errorText } from "../ops/error-text";
import { baseName, namesText } from "../ops/labels";
import { showFolder } from "./place-nav";

// Design 4.2: the pins and recents of the right-hand panel, kept by the
// backend (store_cmds.rs) and followed through its events, so every window
// and every change (a pin from the folder view, a document opened) shows at
// once. Entries whose target is gone are pruned when the panel appears, when
// the window regains focus and when opening one fails. Nothing goes wrong
// quietly: a failure, an entry that could not be checked, a pin removed
// because its target is gone and an unreadable pins or recents file each
// leave a notice in the panel until it is dismissed.

/** The MIME type the backend gives a folder (kernkraft-xdg-apps, through links). */
const FOLDER_MIME = "inode/directory";

/** The files of the backend's store that this panel shows (store.rs). */
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
  loadError: WireError | null;
  notices: Notice[];
  /** Every unreadable store file reported since the start, settings.json included. */
  corrupt: CorruptReport[];
  /** The entry a menu was opened on. */
  current: { list: EntryList; path: WirePath } | null;
  /** Follows the backend's events and prunes; the returned function stops following. */
  follow(): Promise<() => void>;
  /** Drops entries whose target is gone; calls made meanwhile share one prune. */
  prune(): Promise<void>;
  pinPaths(paths: readonly WirePath[]): Promise<void>;
  unpin(path: WirePath): Promise<void>;
  /** Puts the pins in this order. */
  reorder(paths: readonly WirePath[]): Promise<void>;
  /** Moves a pin one place up (-1) or down (1). */
  shift(path: WirePath, by: -1 | 1): Promise<void>;
  /** A folder shows in the current folder tab; a file goes to the open command (design 4.2). */
  open(path: WirePath): Promise<void>;
  setCurrent(current: { list: EntryList; path: WirePath } | null): void;
  dismiss(id: number): void;
  reset(): void;
}

let nextNotice = 1;
let pruning: Promise<void> | null = null;
/** Counts the list events, so a prune answer older than an event does not replace what it said. */
let events = 0;
/** Bumped by reset, so work begun before it does not write into the fresh state. */
let epoch = 0;

const initial = {
  pins: null,
  recents: null,
  kinds: {},
  loadError: null,
  notices: [],
  corrupt: [],
  current: null,
};

export const usePinnedRecent = create<PinnedRecentState>()((set, get) => {
  const notify = (text: string) =>
    set((s) => ({ notices: [...s.notices, { id: nextNotice++, text }] }));

  const fail = (what: string, e: unknown) => notify(`${what}: ${errorText(toWireError(e))}`);

  /** Looks up what the listed paths are that are not known yet. */
  const lookKinds = () => {
    const { pins, recents, kinds } = get();
    const paths = [...(pins ?? []), ...(recents ?? []).map((r) => r.path)];
    const mine = epoch;
    for (const p of paths) {
      const key = pathKey(p);
      if (key in kinds) continue;
      // An entry whose kind could not be looked up keeps the neutral icon; opening it
      // looks again and reports what went wrong.
      mimeOf(p).then(
        (m) => {
          if (mine !== epoch) return;
          const kind: EntryKind = m.mime === FOLDER_MIME ? "folder" : "file";
          set((s) => ({ kinds: { ...s.kinds, [key]: kind } }));
        },
        () => undefined
      );
    }
  };

  const takeCorrupt = async () => {
    const mine = epoch;
    try {
      const reports = await storeErrorsTake();
      if (mine !== epoch || reports.length === 0) return;
      set((s) => ({ corrupt: [...s.corrupt, ...reports] }));
      for (const r of reports.filter((x) => PANEL_FILES.includes(x.file))) {
        notify(corruptText(r));
      }
    } catch (e) {
      fail("The reports of unreadable settings files could not be read", e);
    }
  };

  return {
    ...initial,
    async follow() {
      const mine = epoch;
      const subscribed = await Promise.allSettled([
        on(EVENT_PINS_CHANGED, (p) => {
          events++;
          set({ pins: p.entries });
          lookKinds();
        }),
        on(EVENT_RECENTS_CHANGED, (r) => {
          events++;
          set({ recents: r.entries });
          lookKinds();
        }),
        on(EVENT_STORE_ERROR, () => void takeCorrupt()),
      ]);
      const offs = subscribed.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const stop = () => offs.forEach((off) => off());
      const refused = subscribed.find((r) => r.status === "rejected");
      // The lists are still read; they show what was there when the panel appeared.
      if (refused && mine === epoch) {
        fail(
          "Pinned and Recent will not follow changes",
          (refused as PromiseRejectedResult).reason
        );
      }
      if (mine !== epoch) {
        stop();
        return () => undefined;
      }
      await get().prune();
      await takeCorrupt();
      return stop;
    },
    prune() {
      pruning ??= (async () => {
        const mine = epoch;
        const seen = events;
        try {
          const report = await prune();
          if (mine !== epoch) return;
          set((s) => ({
            loadError: null,
            kinds: {},
            ...(seen === events || s.pins === null
              ? { pins: report.pins.entries, recents: report.recents.entries }
              : {}),
          }));
          if (report.pins_removed.length > 0) {
            notify(
              `Removed from Pinned, since it no longer exists: ${namesText(report.pins_removed.map(baseName))}`
            );
          }
          for (const e of report.errors) {
            notify(
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
    async pinPaths(paths) {
      for (const p of paths) {
        try {
          await pin(p);
        } catch (e) {
          fail(`${baseName(p)} could not be pinned`, e);
        }
      }
    },
    async unpin(path) {
      try {
        await unpin(path);
      } catch (e) {
        fail(`${baseName(path)} could not be unpinned`, e);
      }
    },
    async reorder(paths) {
      try {
        await pinsReorder([...paths]);
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
      for (const e of errors) notify(`${baseName(path)} could not be opened: ${errorText(e)}`);
      // Design 4.2: an entry whose open failed is pruned, if its target is gone.
      await get().prune();
    },
    setCurrent(current) {
      set({ current });
    },
    dismiss(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
    reset() {
      epoch++;
      pruning = null;
      events = 0;
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
