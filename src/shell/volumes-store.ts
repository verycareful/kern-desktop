// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_VOLUMES_CHANGED,
  on,
  toWireError,
  volumeEject,
  volumeMount,
  volumeUnmount,
  volumesList,
  type Device,
  type DiskId,
  type Identity,
  type WireError,
  type WireMount,
} from "../ipc";

// Design 5.3: the volumes of the places strip. The listing comes from
// kernkraft (mounted from /proc/self/mountinfo, unmounted from UDisks2) and
// follows kernkraft://volumes-changed: the listener is put in place before the
// first listing (kernkraft starts its watcher with that listing and the
// event means "list again"), and each event lists again. Mount, unmount and
// eject are commands whose promises settle when UDisks answers, so a volume is
// "busy" from the call to the answer and the rest of the window stays usable.
// Every failure is kept against its volume and shown there with UDisks' own
// message.
//
// A volume is told apart by its identity (device number and disk sequence
// number, kernkraft-volumes' DiskId), which is also what unmount and eject
// are given back: never its UDisks object path or its mount path, which a
// different disk can take over. A volume whose identity is unknown has
// nothing stable to be told apart by (its device node is all there is) and
// nothing to be acted on with: Kern refuses to unmount, eject or mount it.

export type Volume =
  | { kind: "mounted"; key: string; mount: WireMount }
  | { kind: "unmounted"; key: string; device: Device };

const identityKey = (id: Identity, device: string) =>
  id.state === "known" ? `${id.major}:${id.minor}:${id.diskseq}` : `?${device}`;
export const mountedKey = (m: WireMount) => `m:${identityKey(m.identity, m.device)}`;
export const deviceKey = (d: Device) => `d:${identityKey(d.identity, d.device)}`;

/**
 * The keys of a listing's mounted volumes, in order. One disk can be mounted in more than
 * one place; the later mounts of a disk get a number, so every key is unique.
 */
export function mountedKeys(mounted: readonly WireMount[]): string[] {
  const seen = new Map<string, number>();
  return mounted.map((m) => {
    const base = mountedKey(m);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

const diskOf = (id: Extract<Identity, { state: "known" }>): DiskId => ({
  major: id.major,
  minor: id.minor,
  diskseq: id.diskseq,
});

/** A problem that stays on screen until dismissed. */
export interface Kept {
  id: number;
  error: WireError;
}
const sameProblem = (a: WireError, b: WireError) => a.kind === b.kind && a.message === b.message;

export type VolumeAction = "mount" | "unmount" | "eject";
const BUSY_TEXT: Record<VolumeAction, string> = {
  mount: "Mounting…",
  unmount: "Unmounting…",
  eject: "Ejecting…",
};

interface VolumesState {
  mounted: WireMount[];
  unmounted: Device[];
  /** What the latest listing could not find out (a missing source leaves the other's volumes listed). */
  problems: WireError[];
  /**
   * Problems kernkraft reports once: what starting its watcher could not follow (in the first
   * listing) and what the watch met since the last event. They stay until dismissed; a later
   * listing does not clear them.
   */
  kept: Kept[];
  /** The event could not be subscribed to, so the list does not follow changes. */
  watchError: WireError | null;
  /** The listing itself failed. */
  loadError: WireError | null;
  loaded: boolean;
  /** Volume key to what is being done to it. */
  busy: Record<string, string>;
  /** Volume key to why the last action on it failed. */
  errors: Record<string, WireError>;
  /**
   * The volume the volume actions are aimed at: the one last focused or last opened a
   * menu on. Opening the main menu takes the focus off the row, so it is kept until the
   * volume goes away.
   */
  current: string | null;
  /** Counts the volume actions Kern has performed; the Trash reads it to list itself again. */
  epoch: number;
  bump(): void;
  /** Follows kernkraft://volumes-changed and lists; the returned function stops following. */
  follow(): Promise<() => void>;
  dismiss(id: number): void;
  setCurrent(key: string | null): void;
  clearError(key: string): void;
  volumes(): Volume[];
  currentVolume(): Volume | null;
  refresh(): Promise<void>;
  run(volume: Volume, action: VolumeAction): Promise<void>;
  reset(): void;
}

const initial = {
  mounted: [],
  unmounted: [],
  problems: [],
  kept: [],
  watchError: null,
  loadError: null,
  loaded: false,
  busy: {},
  errors: {},
  current: null,
  epoch: 0,
};

// Listings run one at a time: kernkraft hands its once-only problems to the first listing it
// answers, so an answer is never discarded for a newer call; a call made meanwhile asks for one
// more listing after the current one.
let resets = 0;
let nextKept = 1;
let listing: Promise<void> | null = null;
let again = false;
let startupSeen = false;

export const useVolumes = create<VolumesState>()((set, get) => ({
  ...initial,
  setCurrent: (current) => set({ current }),
  dismiss: (id) => set((s) => ({ kept: s.kept.filter((k) => k.id !== id) })),
  async follow() {
    let off: (() => void) | undefined;
    try {
      off = await on(EVENT_VOLUMES_CHANGED, (payload) => {
        keep(set, get, payload.problems);
        void get()
          .refresh()
          .then(() => get().bump());
      });
      set({ watchError: null });
    } catch (e) {
      // The list is read once so it is not empty, with the reason it will not follow changes.
      set({ watchError: toWireError(e) });
    }
    await get().refresh();
    return () => off?.();
  },
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
  clearError: (key) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { errors };
    }),
  volumes() {
    const { mounted, unmounted } = get();
    const keys = mountedKeys(mounted);
    return [
      ...mounted.map((mount, i): Volume => ({ kind: "mounted", key: keys[i]!, mount })),
      ...unmounted.map((device): Volume => ({ kind: "unmounted", key: deviceKey(device), device })),
    ];
  },
  currentVolume() {
    const { current } = get();
    return (
      get()
        .volumes()
        .find((v) => v.key === current) ?? null
    );
  },
  refresh() {
    if (listing) {
      again = true;
      return listing;
    }
    const mine = resets;
    listing = (async () => {
      do {
        again = false;
        try {
          const answer = await volumesList();
          if (mine !== resets) return;
          if (!startupSeen) {
            startupSeen = true;
            keep(set, get, answer.problems);
          }
          set({
            mounted: answer.mounted,
            unmounted: answer.unmounted,
            problems: answer.problems,
            loadError: null,
            loaded: true,
          });
        } catch (e) {
          if (mine !== resets) return;
          // The volumes shown may be stale; they stay, with the reason beside them.
          set({ loadError: toWireError(e), loaded: true });
        }
      } while (again);
    })().finally(() => {
      listing = null;
    });
    return listing;
  },
  async run(volume, action) {
    const { key } = volume;
    if (get().busy[key]) return;
    const identity = volume.kind === "mounted" ? volume.mount.identity : volume.device.identity;
    if (identity.state === "unknown") {
      // Nothing says which disk this is, so nothing is done to it.
      const error: WireError = {
        kind: "IdentityUnknown",
        message: `the volume has no identity: ${identity.reason}`,
        path: null,
        details: null,
      };
      set((s) => ({ errors: { ...s.errors, [key]: error } }));
      return;
    }
    set((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { busy: { ...s.busy, [key]: BUSY_TEXT[action] }, errors };
    });
    try {
      if (action === "mount" && volume.kind === "unmounted") await volumeMount(volume.device);
      else if (action === "unmount" && volume.kind === "mounted") {
        await volumeUnmount(volume.mount.mount_point, diskOf(identity));
      } else if (action === "eject" && volume.kind === "mounted") {
        await volumeEject(volume.mount.mount_point, diskOf(identity));
      } else {
        throw new TypeError(`cannot ${action} a volume that is ${volume.kind}`);
      }
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [key]: toWireError(e) } }));
    } finally {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[key];
        return { busy };
      });
    }
    // The listing is read again whatever happened: a failed eject may have unmounted some.
    await get().refresh();
    get().bump();
  },
  reset() {
    resets++;
    listing = null;
    again = false;
    startupSeen = false;
    set({ ...initial });
  },
}));

type Set = (partial: Partial<VolumesState>) => void;

/** Adds problems to the kept ones, leaving out any already kept. */
function keep(set: Set, get: () => VolumesState, errors: WireError[]): void {
  const kept = [...get().kept];
  for (const error of errors) {
    if (!kept.some((k) => sameProblem(k.error, error))) kept.push({ id: nextKept++, error });
  }
  if (kept.length !== get().kept.length) set({ kept });
}
