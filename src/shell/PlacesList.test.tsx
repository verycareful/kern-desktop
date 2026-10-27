// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath, WireUserDirs } from "../ipc";
import { useTabs, type FolderTab } from "../store/tabs";
import { useUserDirs } from "./user-dirs-store";

const ipc = vi.hoisted(() => ({ userDirs: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { PlacesList } from "./PlacesList";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const dirs = (names: string[]): WireUserDirs => ({
  home: p("/home/t"),
  dirs: names.map((n) => ({ name: n, path: p(`/home/t/${n}`) })),
});
const labels = () =>
  within(screen.getByRole("list"))
    .getAllByRole("button")
    .map((b) => b.textContent);

beforeEach(() => {
  useUserDirs.getState().reset();
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("places_hides_missing_user_dirs", async () => {
  // The backend lists only the folders that exist: no Downloads, Music or Videos here.
  ipc.userDirs.mockResolvedValue(dirs(["desktop", "documents", "pictures"]));
  render(<PlacesList />);
  await screen.findByRole("button", { name: "Home" });
  // Home first, then Documents, Downloads, Desktop as the design names them, then the rest.
  expect(labels()).toEqual(["Home", "Documents", "Desktop", "Pictures"]);
  expect(screen.queryByRole("button", { name: "Downloads" })).toBeNull();
});

test("places_follow_the_design_order_and_the_rest_in_the_backends_order", async () => {
  ipc.userDirs.mockResolvedValue(
    dirs(["desktop", "documents", "download", "music", "pictures", "videos"])
  );
  render(<PlacesList />);
  await screen.findByRole("button", { name: "Home" });
  expect(labels()).toEqual([
    "Home",
    "Documents",
    "Downloads",
    "Desktop",
    "Music",
    "Pictures",
    "Videos",
  ]);
});

test("a_place_that_cannot_be_looked_up_says_so", async () => {
  ipc.userDirs.mockRejectedValue({ kind: "NoHome", message: "no home folder", path: null });
  render(<PlacesList />);
  expect(await screen.findByRole("alert")).toHaveTextContent("no home folder");
});

test("clicking_a_place_navigates_the_current_folder_tab_and_marks_it", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  useTabs.getState().openFolder(p("/home/t"), false);
  const id = useTabs.getState().activeId!;
  render(<PlacesList />);
  expect(await screen.findByRole("button", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  fireEvent.click(screen.getByRole("button", { name: "Documents" }));
  const tab = useTabs.getState().tabs.find((t) => t.id === id) as FolderTab;
  expect(tab.path).toEqual(p("/home/t/documents"));
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
});

test("in_a_document_tab_a_place_navigates_the_most_recent_folder_tab", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  useTabs.getState().openFolder(p("/home/t"), false);
  const folder = useTabs.getState().activeId!;
  useTabs.getState().openDoc(p("/home/t/n.md"));
  const doc = useTabs.getState().activeId!;
  render(<PlacesList />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  const tab = useTabs.getState().tabs.find((t) => t.id === folder) as FolderTab;
  expect(tab.path).toEqual(p("/home/t/documents"));
  expect(useTabs.getState().activeId).toBe(doc);
});

test("from_the_trash_a_place_shows_the_most_recent_folder_tab_there", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  useTabs.getState().openFolder(p("/home/t"), false);
  const folder = useTabs.getState().activeId!;
  useTabs.getState().openTrash();
  render(<PlacesList />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  expect(useTabs.getState().activeId).toBe(folder);
  expect((useTabs.getState().tabs.find((t) => t.id === folder) as FolderTab).path).toEqual(
    p("/home/t/documents")
  );
});

test("with_no_folder_tab_a_place_opens_one", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  render(<PlacesList />);
  fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
  const [tab] = useTabs.getState().tabs;
  expect(tab).toMatchObject({ kind: "folder", path: p("/home/t/documents") });
});

test("the_user_folders_are_looked_up_once_not_on_every_layout_switch", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  const first = render(<PlacesList />);
  await screen.findByRole("button", { name: "Documents" });
  first.unmount();
  render(<PlacesList />);
  expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
  expect(ipc.userDirs).toHaveBeenCalledTimes(1);
});

test("a_volume_holding_the_shown_folder_does_not_also_mark_a_less_specific_place", async () => {
  ipc.userDirs.mockResolvedValue(dirs(["documents"]));
  useTabs.getState().openFolder(p("/home/t/documents"), false);
  render(<PlacesList />);
  expect(await screen.findByRole("button", { name: "Documents" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
});
