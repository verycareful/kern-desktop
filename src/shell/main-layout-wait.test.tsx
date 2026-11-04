// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WindowLayout, WirePath } from "../ipc";
import { NO_LAYOUT, SETTINGS } from "../settings/test-settings";

// The main window draws no layout until its stored one has been read (layout.json), so the layout
// it was left in is the first one it shows. A layout that cannot be read draws the default and
// says so.

const ipc = vi.hoisted(() => ({
  layoutGet: vi.fn(),
  settingsGet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  ...ipc,
  userDirs: () => Promise.resolve({ home: { k: "Utf8", v: "/home/a" }, dirs: [] }),
  volumesList: () => Promise.resolve({ mounted: [], unmounted: [], problems: [] }),
  volumesProblemsTake: () => Promise.resolve([]),
  on: () => Promise.resolve(() => undefined),
  undoState: () => Promise.resolve({ undo: null, redo: null }),
  prune: async () => (await import("./test-pinned-recent")).EMPTY_PRUNE,
  pinsGet: async () => ({ entries: [] }),
  storeErrorsTake: () => Promise.resolve([]),
  listDir: () => Promise.resolve([]),
  watchDir: () => Promise.resolve(),
  unwatchDir: () => Promise.resolve(),
  layoutSet: (patch: object) => Promise.resolve({ ...NO_LAYOUT, ...patch }),
  fileIdentity: () => Promise.resolve([]),
}));

import { useLayout } from "../store/layout";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { useUserDirs } from "./user-dirs-store";
import MainWindow from "./MainWindow";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  useLayout.getState().reset();
  useOps.getState().reset();
  useUserDirs.getState().reset();
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p("/home/a"), false);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("no_layout_is_drawn_until_the_stored_one_is_read_and_then_the_right_one", async () => {
  let reply!: (l: WindowLayout) => void;
  ipc.layoutGet.mockReturnValue(new Promise<WindowLayout>((r) => (reply = r)));
  render(<MainWindow />);
  // Waiting: the window has its frame (status bar) and neither layout.
  expect(screen.getByTestId("main-window")).toBeInTheDocument();
  expect(screen.queryByTestId("main-grid")).toBeNull();
  expect(screen.queryByTestId("places-strip")).toBeNull();
  await act(async () => {});
  expect(screen.queryByTestId("main-grid")).toBeNull();
  // The stored layout is the editor: the first layout drawn is the editor's.
  await act(async () => reply({ ...NO_LAYOUT, layout: "editor" }));
  expect(await screen.findByTestId("main-grid")).toHaveAttribute("data-layout", "editor");
});

test("a_stored_file_manager_layout_draws_the_file_manager", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "file_manager" });
  render(<MainWindow />);
  expect(await screen.findByTestId("main-grid")).toHaveAttribute("data-layout", "folder");
});

test("a_layout_that_cannot_be_read_draws_the_default_and_says_so", async () => {
  ipc.layoutGet.mockRejectedValue({
    kind: "Io",
    message: "layout.json is unreadable",
    path: null,
    details: null,
  });
  render(<MainWindow />);
  expect(await screen.findByTestId("main-grid")).toHaveAttribute("data-layout", "folder");
  await waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(/stored layout could not be read/)
  );
  expect(useOps.getState().notice?.text).toMatch(/layout.json is unreadable/);
});
