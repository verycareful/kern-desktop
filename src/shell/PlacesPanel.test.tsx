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
    density: "cozy",
  } as Settings);
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
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
  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  await waitFor(() => expect(screen.getAllByTestId("file-row")).toHaveLength(1));
  await stripSettled();
  return folderId;
}

test("the_slid_in_panel_shows_the_most_recent_folder_tab", async () => {
  await slideIn();
  expect(screen.getByTestId("folder-view")).toBeInTheDocument();
  expect(ipc.listDir).toHaveBeenCalledWith(p("/d/sub"), false);
});

test("navigating_in_the_slid_in_panel_navigates_that_tab_and_keeps_the_document", async () => {
  const folderId = await slideIn();
  const doc = useTabs.getState().activeId;
  fireEvent.click(
    within(screen.getByRole("navigation", { name: /path/i })).getByRole("button", { name: "d" })
  );
  const tab = useTabs.getState().tabs.find((t) => t.id === folderId) as FolderTab;
  expect(tab.path).toEqual(p("/d"));
  expect(useTabs.getState().tabs).toHaveLength(2);
  expect(useTabs.getState().activeId).toBe(doc);
  // The tab lists its new folder; wait for it so the update lands inside the test.
  await waitFor(() => expect(ipc.listDir).toHaveBeenLastCalledWith(p("/d"), false));
  await waitFor(() => expect(screen.getAllByTestId("file-row")).toHaveLength(1));
});

test("opening_a_file_in_the_slid_in_panel_asks_the_backend_for_a_document_tab", async () => {
  await slideIn();
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/sub/n.txt"), action: "doc_tab", location: null, error: null },
  ]);
  fireEvent.doubleClick(screen.getByTestId("file-row"));
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  // Origin "inside": the backend decides and sends the directive that opens the tab (design 4.3).
  expect(ipc.openPaths).toHaveBeenCalledWith([p("/d/sub/n.txt")], "inside", "default");
});

test("with_no_folder_tab_the_slid_in_panel_has_no_folder_view", async () => {
  useTabs.getState().openDoc(p("/d/old.md"));
  render(<MainWindow />);
  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  await stripSettled();
  expect(screen.getByTestId("folder-area")).toBeEmptyDOMElement();
});
