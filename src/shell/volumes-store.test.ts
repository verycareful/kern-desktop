// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VolumesChanged } from "../ipc";
import { device, diskOf, known, mount, problem, volumes } from "./test-volumes";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  volumesList: vi.fn(),
  volumeMount: vi.fn(),
  volumeUnmount: vi.fn(),
  volumeEject: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { deviceKey, mountedKey, useVolumes } from "./volumes-store";

// Design 5.3 and kernkraft-tauri's volumes_cmds.rs: the list follows
// kernkraft://volumes-changed, the listener is in place before the first
// listing, problems that are reported once stay until dismissed, and a volume
// is told apart by its identity.

let handler: ((payload: VolumesChanged) => void) | undefined;
const fire = (problems: VolumesChanged["problems"] = []) =>
  act(async () => {
    handler!({ problems });
    await Promise.resolve();
  });

beforeEach(() => {
  useVolumes.getState().reset();
  handler = undefined;
  ipc.on.mockImplementation((name: string, h: (payload: VolumesChanged) => void) => {
    if (name === "kernkraft://volumes-changed") handler = h;
    return Promise.resolve(() => undefined);
  });
  ipc.volumesList.mockResolvedValue(volumes({}));
});
afterEach(() => vi.clearAllMocks());

test("the_listener_is_in_place_before_the_first_listing", async () => {
  let subscribed!: () => void;
  ipc.on.mockImplementation(
    () =>
      new Promise((r) => {
        subscribed = () => r(() => undefined);
      })
  );
  const following = useVolumes.getState().follow();
  await Promise.resolve();
  // The subscription has not been confirmed: nothing may have been listed.
  expect(ipc.on).toHaveBeenCalledWith("kernkraft://volumes-changed", expect.any(Function));
  expect(ipc.volumesList).not.toHaveBeenCalled();
  subscribed();
  await following;
  expect(ipc.volumesList).toHaveBeenCalledTimes(1);
  expect(ipc.on.mock.invocationCallOrder[0]).toBeLessThan(
    ipc.volumesList.mock.invocationCallOrder[0]!
  );
});

test("each_event_lists_the_volumes_again", async () => {
  await useVolumes.getState().follow();
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  await fire();
  expect(ipc.volumesList).toHaveBeenCalledTimes(2);
  expect(useVolumes.getState().mounted.map((m) => m.label)).toEqual(["STICK"]);
  ipc.volumesList.mockResolvedValue(volumes({}));
  await fire();
  expect(useVolumes.getState().mounted).toEqual([]);
});

test("an_event_bumps_the_epoch_so_the_trash_lists_again", async () => {
  await useVolumes.getState().follow();
  const before = useVolumes.getState().epoch;
  await fire();
  await vi.waitFor(() => expect(useVolumes.getState().epoch).toBeGreaterThan(before));
});

test("stopping_follows_no_more_events", async () => {
  const off = vi.fn();
  ipc.on.mockResolvedValue(off);
  const stop = await useVolumes.getState().follow();
  stop();
  expect(off).toHaveBeenCalledTimes(1);
});

test("problems_reported_once_stay_until_dismissed", async () => {
  ipc.volumesList.mockResolvedValueOnce(volumes({ problems: [problem("UdisksAbsent")] }));
  await useVolumes.getState().follow();
  expect(useVolumes.getState().kept.map((k) => k.error.kind)).toEqual(["UdisksAbsent"]);
  // The next listing does not carry it again, and does not clear it.
  await useVolumes.getState().refresh();
  await fire();
  expect(useVolumes.getState().kept.map((k) => k.error.kind)).toEqual(["UdisksAbsent"]);
  const [first] = useVolumes.getState().kept;
  act(() => useVolumes.getState().dismiss(first!.id));
  expect(useVolumes.getState().kept).toEqual([]);
});

test("watch_problems_in_an_event_stay_until_dismissed", async () => {
  await useVolumes.getState().follow();
  await fire([problem("CallbackPanic", "boom")]);
  await fire();
  await fire([problem("CallbackPanic", "boom")]);
  // The same problem twice is one notice.
  expect(useVolumes.getState().kept.map((k) => k.error.kind)).toEqual(["CallbackPanic"]);
});

test("only_the_first_listing_is_kept_not_every_listing_problem", async () => {
  ipc.volumesList.mockResolvedValueOnce(volumes({}));
  await useVolumes.getState().follow();
  // A later listing's own problems describe the present: shown while they apply, then gone.
  ipc.volumesList.mockResolvedValueOnce(volumes({ problems: [problem("Labels")] }));
  await useVolumes.getState().refresh();
  expect(useVolumes.getState().problems.map((e) => e.kind)).toEqual(["Labels"]);
  expect(useVolumes.getState().kept).toEqual([]);
  ipc.volumesList.mockResolvedValueOnce(volumes({}));
  await useVolumes.getState().refresh();
  expect(useVolumes.getState().problems).toEqual([]);
});

test("a_failed_subscription_is_shown_and_the_volumes_are_still_listed", async () => {
  ipc.on.mockRejectedValue(problem("Ipc", "no event system"));
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  await useVolumes.getState().follow();
  expect(useVolumes.getState().watchError?.message).toBe("no event system");
  expect(useVolumes.getState().mounted).toHaveLength(1);
});

test("a_volume_key_comes_from_its_identity_not_its_path_or_node", () => {
  const a = mount("X", { device: "/dev/sdb1" });
  // Same disk, remounted elsewhere and seen under another device node: the same volume.
  expect(mountedKey({ ...a, device: "/dev/sdc1", mount_point: { k: "Utf8", v: "/mnt/x" } })).toBe(
    mountedKey(a)
  );
  // Another disk at the same node and path (unplugged and replugged): another volume.
  const replugged = {
    ...a,
    identity: { ...known("X"), diskseq: 99999 },
  } as typeof a;
  expect(mountedKey(replugged)).not.toBe(mountedKey(a));
  // An unmounted device of the same disk is not the mounted key's namesake.
  expect(deviceKey(device("X"))).not.toBe(mountedKey(a));
});

test("volumes_with_an_unknown_identity_are_told_apart_by_their_device_node", () => {
  const unknown = { state: "unknown", reason: "no diskseq" } as const;
  const a = mount("A", { identity: unknown, device: "/dev/sdb1" });
  const b = mount("B", { identity: unknown, device: "/dev/sdc1" });
  expect(mountedKey(a)).not.toBe(mountedKey(b));
  expect(deviceKey(device("A", { identity: unknown }))).not.toBe(
    deviceKey(device("B", { identity: unknown }))
  );
});

test("two_mounts_of_one_disk_get_two_keys", async () => {
  ipc.volumesList.mockResolvedValue(
    volumes({
      mounted: [
        mount("DATA", { mount_point: { k: "Utf8", v: "/mnt/a" } }),
        mount("DATA", { mount_point: { k: "Utf8", v: "/mnt/b" } }),
      ],
    })
  );
  await useVolumes.getState().refresh();
  const keys = useVolumes
    .getState()
    .volumes()
    .map((v) => v.key);
  expect(new Set(keys).size).toBe(2);
});

test("unmount_and_eject_send_the_identity_as_listed", async () => {
  const m = mount("STICK");
  ipc.volumeUnmount.mockResolvedValue(undefined);
  ipc.volumeEject.mockResolvedValue(undefined);
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [m] }));
  await useVolumes.getState().refresh();
  const v = useVolumes.getState().volumes()[0]!;
  await useVolumes.getState().run(v, "unmount");
  expect(ipc.volumeUnmount).toHaveBeenCalledWith(m.mount_point, diskOf("STICK"));
  await useVolumes.getState().run(v, "eject");
  expect(ipc.volumeEject).toHaveBeenCalledWith(m.mount_point, diskOf("STICK"));
});

test("mount_sends_the_whole_device_as_listed", async () => {
  const d = device("BACKUP");
  ipc.volumeMount.mockResolvedValue({ k: "Utf8", v: "/run/media/t/BACKUP" });
  ipc.volumesList.mockResolvedValue(volumes({ unmounted: [d] }));
  await useVolumes.getState().refresh();
  await useVolumes.getState().run(useVolumes.getState().volumes()[0]!, "mount");
  expect(ipc.volumeMount).toHaveBeenCalledWith(d);
});

test("an_action_on_a_volume_with_no_identity_is_refused_without_calling_kernkraft", async () => {
  const unknown = { state: "unknown", reason: "kernel older than 5.15" } as const;
  ipc.volumesList.mockResolvedValue(
    volumes({
      mounted: [mount("OLD", { identity: unknown })],
      unmounted: [device("RAW", { identity: unknown })],
    })
  );
  await useVolumes.getState().refresh();
  for (const v of useVolumes.getState().volumes()) {
    for (const action of ["unmount", "eject", "mount"] as const) {
      await useVolumes.getState().run(v, action);
    }
    expect(useVolumes.getState().errors[v.key]?.kind).toBe("IdentityUnknown");
    expect(useVolumes.getState().errors[v.key]?.message).toContain("kernel older than 5.15");
  }
  expect(ipc.volumeUnmount).not.toHaveBeenCalled();
  expect(ipc.volumeEject).not.toHaveBeenCalled();
  expect(ipc.volumeMount).not.toHaveBeenCalled();
});
