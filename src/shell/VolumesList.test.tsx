// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VolumesChanged, WirePath } from "../ipc";
import { device, diskOf, known, mount, problem, volumes } from "./test-volumes";
import { useTabs } from "../store/tabs";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  volumesList: vi.fn(),
  volumeMount: vi.fn(),
  volumeUnmount: vi.fn(),
  volumeEject: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { VolumesList } from "./VolumesList";
import { useVolumes } from "./volumes-store";

const p = (v: string): WirePath => ({ k: "Utf8", v });

let fire: (payload?: VolumesChanged) => Promise<void>;
beforeEach(() => {
  useVolumes.getState().reset();
  ipc.on.mockImplementation((name: string, h: (payload: VolumesChanged) => void) => {
    if (name === "kernkraft://volumes-changed") {
      fire = (payload = { problems: [] }) =>
        act(async () => {
          h(payload);
          await Promise.resolve();
        });
    }
    return Promise.resolve(() => undefined);
  });
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
  expect(ipc.volumeUnmount).toHaveBeenCalledWith(p("/run/media/t/STICK"), diskOf("STICK"));
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
  await waitFor(() =>
    expect(ipc.volumeUnmount).toHaveBeenCalledWith(p("/run/media/t/OTHER"), diskOf("OTHER"))
  );
});

test("volume_actions_are_not_in_the_main_menu_but_in_the_volumes_own_menu", async () => {
  const { menuSections } = await import("../keys/actions");
  useTabs.getState().openFolder(p("/home/t"), false);
  const tab = useTabs.getState().tabs[0]!;
  const ids = menuSections(tab).flatMap((sec) => sec.actions.map((a) => a.id));
  for (const id of ["volume.mount", "volume.unmount", "volume.eject"]) {
    expect(ids).not.toContain(id);
  }
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  for (const name of [/unmount/i, /eject/i, /mount/i]) {
    expect(within(menu).getAllByRole("menuitem", { name }).length).toBeGreaterThan(0);
  }
});

test("the_context_menu_acts_on_the_right_clicked_device_not_the_focused_one", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK"), mount("OTHER")] }));
  ipc.volumeUnmount.mockResolvedValue(undefined);
  render(<VolumesList />);
  (await screen.findByRole("button", { name: "STICK" })).focus();
  const menu = await openMenu("OTHER");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /unmount/i }));
  await waitFor(() =>
    expect(ipc.volumeUnmount).toHaveBeenCalledWith(p("/run/media/t/OTHER"), diskOf("OTHER"))
  );
  expect(ipc.volumeUnmount).toHaveBeenCalledTimes(1);
});

test("the_most_specific_volume_is_marked_current", async () => {
  ipc.volumesList.mockResolvedValue(
    volumes({
      mounted: [
        mount("OUTER", { mount_point: p("/mnt") }),
        mount("INNER", { mount_point: p("/mnt/usb") }),
      ],
    })
  );
  useTabs.getState().openFolder(p("/mnt/usb/docs"), false);
  render(<VolumesList />);
  await screen.findByRole("button", { name: "INNER" });
  expect(screen.getByRole("button", { name: "INNER" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "OUTER" })).not.toHaveAttribute("aria-current");
});

test("the_list_follows_the_volumes_changed_event", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  render(<VolumesList />);
  await screen.findByRole("button", { name: "STICK" });
  ipc.volumesList.mockResolvedValue(
    volumes({ mounted: [mount("STICK"), mount("CARD")], unmounted: [device("BACKUP")] })
  );
  await fire();
  await screen.findByRole("button", { name: "CARD" });
  expect(screen.getByRole("button", { name: "Mount BACKUP" })).toBeInTheDocument();
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("CARD")] }));
  await fire();
  await waitFor(() => expect(screen.queryByRole("button", { name: "STICK" })).toBeNull());
});

test("the_event_is_subscribed_to_before_the_first_listing", async () => {
  ipc.volumesList.mockResolvedValue(volumes({}));
  render(<VolumesList />);
  await waitFor(() => expect(ipc.volumesList).toHaveBeenCalled());
  expect(ipc.on.mock.invocationCallOrder[0]).toBeLessThan(
    ipc.volumesList.mock.invocationCallOrder[0]!
  );
});

test("a_problem_reported_once_stays_on_screen_until_it_is_dismissed", async () => {
  ipc.volumesList
    .mockResolvedValueOnce(volumes({ problems: [problem("UdisksAbsent")] }))
    .mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  render(<VolumesList />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/UDisks2 is not running/);
  // The listing after it, and an event, do not clear it.
  await fire();
  await screen.findByRole("button", { name: "STICK" });
  expect(screen.getByRole("alert")).toHaveTextContent(/UDisks2 is not running/);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss the UdisksAbsent notice" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_problem_in_an_event_is_shown_in_plain_words_and_kept", async () => {
  ipc.volumesList.mockResolvedValue(volumes({}));
  render(<VolumesList />);
  await screen.findByText("No volumes.");
  await fire({ problems: [problem("CallbackPanic", "boom")] });
  expect(await screen.findByRole("alert")).toHaveTextContent(/watcher hit an internal error/);
  await fire();
  expect(screen.getByRole("alert")).toHaveTextContent(/watcher hit an internal error/);
});

test("an_identity_mismatch_is_explained_and_the_list_read_again", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  ipc.volumeUnmount.mockRejectedValue(
    problem("IdentityMismatch", "not the volume that was listed: disk changed")
  );
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  const calls = ipc.volumesList.mock.calls.length;
  fireEvent.click(within(menu).getByRole("menuitem", { name: /unmount/i }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/no longer the volume that was listed/);
  expect(alert).toHaveTextContent("disk changed");
  await waitFor(() => expect(ipc.volumesList.mock.calls.length).toBeGreaterThan(calls));
});

const unknown = {
  state: "unknown",
  reason: "no disk sequence number: kernel older than 5.15",
} as const;

test("a_mounted_volume_with_no_identity_shows_why_and_has_no_unmount_or_eject", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("OLD", { identity: unknown })] }));
  render(<VolumesList />);
  const menu = await openMenu("OLD");
  expect(screen.getByText(/kernel older than 5.15/)).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: /unmount/i })).toBeDisabled();
  expect(within(menu).getByRole("menuitem", { name: /eject/i })).toBeDisabled();
  fireEvent.click(within(menu).getByRole("menuitem", { name: /unmount/i }));
  expect(ipc.volumeUnmount).not.toHaveBeenCalled();
});

test("an_unmounted_device_with_no_identity_shows_why_and_cannot_be_mounted", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ unmounted: [device("RAW", { identity: unknown })] }));
  render(<VolumesList />);
  const button = await screen.findByRole("button", { name: "Mount RAW" });
  expect(button).toBeDisabled();
  expect(screen.getByText(/kernel older than 5.15/)).toBeInTheDocument();
  fireEvent.click(button);
  expect(ipc.volumeMount).not.toHaveBeenCalled();
});

test("a_replugged_disk_at_the_same_path_is_not_the_volume_that_was_busy", async () => {
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [mount("STICK")] }));
  let finish!: () => void;
  ipc.volumeEject.mockReturnValue(new Promise<void>((r) => (finish = r)));
  render(<VolumesList />);
  const menu = await openMenu("STICK");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /eject/i }));
  await screen.findByRole("status");
  // Another disk now shows at the same node and path: it is a different volume, not busy.
  const other = mount("STICK", { identity: { ...known("STICK"), diskseq: 7 } as never });
  ipc.volumesList.mockResolvedValue(volumes({ mounted: [other] }));
  await fire();
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  await act(async () => finish());
});
