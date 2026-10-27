// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Device, WireMount, WirePath, WireVolumes } from "../ipc";
import { useTabs } from "../store/tabs";

const ipc = vi.hoisted(() => ({
  volumesList: vi.fn(),
  volumeMount: vi.fn(),
  volumeUnmount: vi.fn(),
  volumeEject: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { VolumesList } from "./VolumesList";
import { useVolumes } from "./volumes-store";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const mount = (label: string, over: Partial<WireMount> = {}): WireMount => ({
  mount_point: p(`/run/media/t/${label}`),
  device: "/dev/sdb1",
  fs_type: "vfat",
  label,
  removable: true,
  read_only: false,
  ...over,
});
const device = (label: string, over: Partial<Device> = {}): Device => ({
  object_path: `/org/freedesktop/UDisks2/block_devices/${label}`,
  device: `/dev/${label}`,
  label,
  fs_type: "ext4",
  size: 8_000_000_000,
  system: false,
  ...over,
});
const volumes = (v: Partial<WireVolumes>): WireVolumes => ({
  mounted: [],
  unmounted: [],
  problems: [],
  ...v,
});

beforeEach(() => {
  useVolumes.getState().reset();
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openMenu(name: string) {
  fireEvent.contextMenu(await screen.findByRole("button", { name }));
  return screen.findByRole("menu");
}

test("volume_busy_error_shown", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  ipc.volumeUnmount.mockRejectedValue({
    kind: "Busy",
    message: "target is busy: held by process 4211 (bash)",
    path: null,
    details: null,
  });
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /unmount/i }));
  // UDisks' own words are shown, beside the volume, as an alert.
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Busy");
  expect(alert).toHaveTextContent("target is busy: held by process 4211 (bash)");
  expect(ipc.volumeUnmount).toHaveBeenCalledWith(p("/run/media/t/STICK"));
  // The volume is not busy any more and can be tried again.
  expect(screen.getByRole("button", { name: "STICK" })).not.toHaveAttribute("aria-busy", "true");
});

test("mounted_volumes_come_first_then_unmounted_ones_with_a_mount_button", async () => {
  ipc.volumesList.mockResolvedValue(
    volumes({ mounted: [mount("STICK")], unmounted: [device("BACKUP")] })
  );
  render(<VolumesList />);
  await screen.findByRole("button", { name: "STICK" });
  const items = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("STICK");
  expect(items[1]).toHaveTextContent("BACKUP");
  ipc.volumeMount.mockResolvedValue(p("/run/media/t/BACKUP"));
  ipc.volumesList.mockResolvedValue(
    volumes({ mounted: [mount("STICK"), mount("BACKUP")], unmounted: [] })
  );
  fireEvent.click(within(items[1]!).getByRole("button", { name: /mount/i }));
  await waitFor(() => expect(ipc.volumeMount).toHaveBeenCalledWith(device("BACKUP")));
  await screen.findByRole("button", { name: "BACKUP" });
});

test("a_busy_volume_shows_progress_and_the_ui_stays_usable", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK"), mount("OTHER")] }));
  let finish!: () => void;
  ipc.volumeEject.mockReturnValue(new Promise<void>((r) => (finish = r)));
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /eject/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/ejecting/i);
  expect(screen.getByRole("button", { name: "STICK" })).toHaveAttribute("aria-busy", "true");
  // Another volume can be used meanwhile.
  fireEvent.click(screen.getByRole("button", { name: "OTHER" }));
  expect(useTabs.getState().tabs).toHaveLength(1);
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("OTHER")] }));
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("button", { name: "STICK" })).toBeNull());
});

test("an_incomplete_eject_says_what_was_unmounted", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  ipc.volumeEject.mockRejectedValue({
    kind: "EjectIncomplete",
    message: "eject incomplete: unmounted 1 volume(s), then /run/media/t/B failed: busy",
    path: null,
    details: {
      k: "EjectIncomplete",
      unmounted: [p("/run/media/t/A")],
      locked: [],
      failed: "/run/media/t/B",
      cause: { kind: "Busy", message: "busy", path: null, details: null },
    },
  });
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /eject/i }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("EjectIncomplete");
  expect(alert).toHaveTextContent("/run/media/t/A");
});

test("a_volume_that_cannot_be_ejected_has_no_eject_entry_enabled", async () => {
  ipc.volumesList.mockResolvedValue(
    volumes({ mounted: [mount("DISK", { removable: false, mount_point: p("/mnt/data") })] })
  );
  render(<VolumesList />);
  const menu = await openMenu("DISK");
  expect(within(menu).getByRole("menuitem", { name: /eject/i })).toBeDisabled();
  expect(within(menu).getByRole("menuitem", { name: /unmount/i })).toBeEnabled();
});

test("listing_problems_and_a_failed_listing_are_shown", async () => {
  ipc.volumesList.mockResolvedValue(
    volumes({
      problems: [{ kind: "Dbus", message: "UDisks is not running", path: null, details: null }],
    })
  );
  render(<VolumesList />);
  expect(await screen.findByRole("alert")).toHaveTextContent("UDisks is not running");
  cleanup();
  useVolumes.getState().reset();
  ipc.volumesList.mockRejectedValue({
    kind: "Io",
    message: "cannot read mountinfo",
    path: null,
    details: null,
  });
  render(<VolumesList />);
  expect(await screen.findByRole("alert")).toHaveTextContent("cannot read mountinfo");
});

test("clicking_a_volume_navigates_the_current_folder_tab_to_its_mount_point", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  useTabs.getState().openFolder(p("/home/t"), false);
  render(<VolumesList />);
  fireEvent.click(await screen.findByRole("button", { name: "STICK" }));
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: p("/run/media/t/STICK") });
  expect(screen.getByRole("button", { name: "STICK" })).toHaveAttribute("aria-current", "page");
});

test("the_menu_key_opens_the_volume_menu_and_its_actions_run_on_that_volume", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK"), mount("OTHER")] }));
  ipc.volumeUnmount.mockResolvedValue(undefined);
  render(<VolumesList />);
  const other = await screen.findByRole("button", { name: "OTHER" });
  other.focus();
  fireEvent.keyDown(other, { key: "ContextMenu" });
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /unmount/i }));
  await waitFor(() => expect(ipc.volumeUnmount).toHaveBeenCalledWith(p("/run/media/t/OTHER")));
});
