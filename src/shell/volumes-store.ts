// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  pathKey,
  toWireError,
  volumeEject,
  volumeMount,
  volumeUnmount,
  volumesList,
  type Device,
  type WireError,
  type WireMount,
} from "../ipc";

// Design 5.3: the volumes of the places strip. The listing comes from
// kernkraft (mounted from /proc/self/mountinfo, unmounted from UDisks2);
// mount, unmount and eject are commands whose promises settle when UDisks
// answers, so a volume is "busy" from the call to the answer and the rest of
// the window stays usable. Every failure is kept against its volume and shown
// there with UDisks' own message.

export type Volume =
  | { kind: "mounted"; key: string; mount: WireMount }
  | { kind: "unmounted"; key: string; device: Device };

export const mountedKey = (m: WireMount) => `m:${pathKey(m.mount_point)}`;
export const deviceKey = (d: Device) => `d:${d.object_path}`;

export type VolumeAction = "mount" | "unmount" | "eject";
const BUSY_TEXT: Record<VolumeAction, string> = {
  mount: "Mounting…",
  unmount: "Unmounting…",
  eject: "Ejecting…",
};

interface VolumesState {
  mounted: WireMount[];
  unmounted: Device[];
  /** What the listing could not find out (a missing source leaves the other's volumes listed). */
  problems: WireError[];
  /** The listing itself failed. */
  loadError: WireError | null;
  loaded: boolean;
  /** Volume key to what is being done to it. */
  busy: Record<string, string>;
  /** Volume key to why the last action on it failed. */
  errors: Record<string, WireError>;
  /** The volume the volume actions are aimed at: the one with focus, or a menu opened on. */
  current: string | null;
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
  loadError: null,
  loaded: false,
  busy: {},
  errors: {},
  current: null,
};

let listSeq = 0;

export const useVolumes = create<VolumesState>()((set, get) => ({
  ...initial,
  setCurrent: (current) => set({ current }),
  clearError: (key) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { errors };
    }),
  volumes() {
    const { mounted, unmounted } = get();
    return [
      ...mounted.map((mount): Volume => ({ kind: "mounted", key: mountedKey(mount), mount })),
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
  async refresh() {
    // A slow answer to an older call never replaces a newer one.
    const mine = ++listSeq;
    try {
      const listing = await volumesList();
      if (mine !== listSeq) return;
      set({
        mounted: listing.mounted,
        unmounted: listing.unmounted,
        problems: listing.problems,
        loadError: null,
        loaded: true,
      });
    } catch (e) {
      if (mine !== listSeq) return;
      // The volumes shown may be stale; they stay, with the reason beside them.
      set({ loadError: toWireError(e), loaded: true });
    }
  },
  async run(volume, action) {
    const { key } = volume;
    if (get().busy[key]) return;
    set((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { busy: { ...s.busy, [key]: BUSY_TEXT[action] }, errors };
    });
    try {
      if (action === "mount" && volume.kind === "unmounted") await volumeMount(volume.device);
      else if (action === "unmount" && volume.kind === "mounted") {
        await volumeUnmount(volume.mount.mount_point);
      } else if (action === "eject" && volume.kind === "mounted") {
        await volumeEject(volume.mount.mount_point);
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
  },
  reset() {
    listSeq++;
    set({ ...initial });
  },
}));
