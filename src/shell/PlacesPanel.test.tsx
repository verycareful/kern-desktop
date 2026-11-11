// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WirePath } from "../ipc";
import { stubLayout } from "../files/test-layout";
import { entry } from "../files/test-entries";
import { useViewSettings } from "../files/view-settings";
import { usePanelsStore } from "../store/panels";
import { useTabs, type FolderTab } from "../store/tabs";

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  openPaths: vi.fn(),
  userDirs: vi.fn(),
  volumesList: vi.fn(),
  volumesProblemsTake: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import MainWindow from "./MainWindow";
import { useUserDirs } from "./user-dirs-store";
import { useVolumes } from "./volumes-store";

const p = (v: string): WirePath => ({ k: "Utf8", v });
let restore: () => void;

beforeEach(() => {
  restore = stubLayout();
  ipc.on.mockResolvedValue(() => undefined);
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "list",
    panel_order: ["places", "folder", "pinned"],
    editor_panel_order: ["places", "pinned"],
  } as Settings);
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
  ipc.volumesProblemsTake.mockResolvedValue([]);
  ipc.volumesList.mockResolvedValue({ mounted: [], unmounted: [], problems: [] });
  useUserDirs.getState().reset();
  useVolumes.getState().reset();
  ipc.listDir.mockResolvedValue([entry("n.txt", { mime: "text/plain" }, "/d/sub")]);
  useViewSettings.setState({ loaded: false, error: null });
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restore();
  vi.clearAllMocks();
});

// The strip looks the user's folders and the volumes up as it appears; the tests wait for both.
async function stripSettled() {
  await screen.findByText("No volumes.");
  await screen.findByRole("button", { name: "Home" });
}

async function slideIn() {
  useTabs.getState().openFolder(p("/d/sub"), false);
  const folderId = useTabs.getState().activeId!;
  useTabs.getState().openDoc(p("/d/old.md"));
  render(<MainWindow />);
  // The window draws once its stored layout is read.
  await screen.findByTestId("main-grid");
  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  await stripSettled();
  return folderId;
}

test("the_slid_in_panel_holds_the_places_strip_and_no_folder_view", async () => {
  await slideIn();
  const panel = screen.getByTestId("places-panel");
  expect(within(panel).getByTestId("places-strip")).toBeInTheDocument();
  expect(screen.queryByTestId("folder-area")).toBeNull();
  expect(screen.queryByTestId("folder-view")).toBeNull();
  expect(ipc.listDir).not.toHaveBeenCalled();
});

test("a_place_in_the_slid_in_panel_opens_its_folder_and_leaves_the_other_folder_tab_alone", async () => {
  const folderId = await slideIn();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  const { tabs, activeId } = useTabs.getState();
  expect((tabs.find((t) => t.id === folderId) as FolderTab).path).toEqual(p("/d/sub"));
  expect(tabs).toHaveLength(3);
  const shown = tabs.find((t) => t.id === activeId) as FolderTab;
  expect(shown.kind).toBe("folder");
  expect(shown.path).toEqual(p("/home/t"));
  await waitFor(() => expect(ipc.listDir).toHaveBeenCalledWith(p("/home/t"), false));
});

test("a_place_whose_folder_is_open_in_a_tab_brings_that_tab_forward", async () => {
  useTabs.getState().openFolder(p("/home/t"), false);
  const home = useTabs.getState().activeId!;
  useTabs.getState().openFolder(p("/d/sub"), true);
  useTabs.getState().openDoc(p("/d/old.md"));
  render(<MainWindow />);
  await screen.findByTestId("main-grid");
  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  await stripSettled();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(useTabs.getState().activeId).toBe(home);
  expect(useTabs.getState().tabs).toHaveLength(3);
  await waitFor(() => expect(ipc.listDir).toHaveBeenCalledWith(p("/home/t"), false));
});

test("with_no_folder_tab_the_slid_in_panel_still_shows_the_places_strip", async () => {
  useTabs.getState().openDoc(p("/d/old.md"));
  render(<MainWindow />);
  await screen.findByTestId("main-grid");
  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  await stripSettled();
  expect(screen.getByTestId("places-strip")).toBeInTheDocument();
  expect(screen.queryByTestId("folder-area")).toBeNull();
});
