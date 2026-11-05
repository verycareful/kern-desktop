// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useUserDirs } from "./shell/user-dirs-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WireTheme } from "./ipc/kernkraft";
import App from "./App";
import { useViewSettings } from "./files/view-settings";
import { useTabs } from "./store/tabs";

const themeGet = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      css: ":root{}",
      tokens: { scheme: "light" },
      fallbacks: [],
      problems: [],
    } as unknown as WireTheme)
  )
);
const STORED = vi.hoisted(() => ({
  follow: { colours: true, accent: true, fonts: true, radius: true },
  theme_mode: "system",
  accent: "slate",
  show_hidden: false,
  view_mode: "list",
  default_layout: "file_manager",
  new_tab_folder: null,
  new_tab_default: "folder",
}));
const settingsGet = vi.hoisted(() => vi.fn(() => Promise.resolve({ ...STORED } as unknown)));
const userDirs = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ home: { k: "Utf8", v: "/home/t" }, dirs: [] }))
);

vi.mock("./ipc", async () => ({
  ...(await import("./ipc/wire-path")),
  EVENT_THEME_CHANGED: "kernkraft://theme-changed",
  EVENT_SETTINGS_CHANGED: "kern://settings-changed",
  EVENT_DIR_CHANGED: "kernkraft://dir-changed",
  EVENT_DIR_GONE: "kernkraft://dir-gone",
  EVENT_VOLUMES_CHANGED: "kernkraft://volumes-changed",
  EVENT_DROP: "kern://drop",
  EVENT_DROP_REFUSED: "kern://drop-refused",
  EVENT_DRAG_OVER: "kern://drag-over",
  EVENT_DRAG_FILES: "kern://drag-files",
  EVENT_DRAG_REFUSAL: "kern://drag-refusal",
  EVENT_DRAG_LEAVE: "kern://drag-leave",
  // The file operations host reads the undo history once.
  undoState: () => Promise.resolve({ undo: null, redo: null }),
  // The folder view of the Home tab: an empty folder.
  listDir: () => Promise.resolve([]),
  watchDir: () => Promise.resolve(),
  unwatchDir: () => Promise.resolve(),
  on: () => Promise.resolve(() => undefined),
  openPendingTake: () => Promise.resolve([]),
  confirmClose: () => Promise.resolve(),
  // The tabs kept for the next launch.
  sessionPut: () => Promise.resolve(),
  // No windows from last time to offer.
  sessionClosedGet: () => Promise.resolve(0),
  layoutGet: () => Promise.resolve({ left_width: 280, left_open: true, tree_root: null }),
  isMainWindow: () => true,
  isEditorWindow: () => false,
  isSettingsWindow: () => false,
  THEME_DENSITY: "cozy",
  isDocumentWindow: () => false,
  tabWindow: () => "main",
  currentWindowLabel: () => "main",
  EVENT_OPEN: "kern://open",
  EVENT_SELECT: "kern://select",
  EVENT_OPEN_ERROR: "kern://open-error",
  EVENT_PROPERTIES: "kern://properties",
  EVENT_ADOPT_DOC: "kern://adopt-doc",
  EVENT_ADOPT_CANCELLED: "kern://adopt-cancelled",
  EVENT_CLOSE_REQUESTED: "kern://close-requested",
  settingsGet,
  themeGet,
  userDirs,
  volumesList: () => Promise.resolve({ mounted: [], unmounted: [], problems: [] }),
  volumesProblemsTake: () => Promise.resolve([]),
  // Pinned and Recent: nothing pinned or recent.
  EVENT_PINS_CHANGED: "kern://pins-changed",
  EVENT_RECENTS_CHANGED: "kern://recents-changed",
  EVENT_STORE_ERROR: "kern://store-error",
  prune: async () => (await import("./shell/test-pinned-recent")).EMPTY_PRUNE,
  pinsGet: async () => ({ entries: [] }),
  storeErrorsTake: () => Promise.resolve([]),
  toWireError: (e: unknown) => e,
}));

beforeEach(() => {
  useUserDirs.getState().reset();
  useViewSettings.setState({ loaded: false, error: null, newTabFolder: null });
  settingsGet.mockClear();
  settingsGet.mockImplementation(() => Promise.resolve({ ...STORED }));
  useTabs.setState({ tabs: [], activeId: null });
  userDirs.mockClear();
});

test("renders_shell_root", async () => {
  render(<App />);
  expect(screen.getByTestId("shell")).toBeInTheDocument();
  // The hook has settled once it has written the theme the mocked themeGet gave.
  await waitFor(() => expect(document.head.querySelector("style#kern-tokens")).not.toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  // The Home folder tab opens once user_dirs answers.
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/t");
});

test("closing_the_last_tab_opens_home_again", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Close t" }));
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(useTabs.getState().tabs).toHaveLength(1);
  // Home is looked up once and kept: the strip and the second Home tab reuse it.
  expect(userDirs).toHaveBeenCalledTimes(1);
});

test("home_lookup_failure_shows_the_error_with_retry", async () => {
  userDirs.mockImplementationOnce(() => Promise.reject({ kind: "Io", message: "no home" }));
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("no home");
  expect(screen.queryByRole("tab")).toBeNull();
  // Neither the "opening" note nor an empty-state claim sits beside the failure.
  expect(screen.queryByText(/Opening the new tab folder/)).toBeNull();
  expect(userDirs).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  // Retry made one lookup, not two; the places strip reuses it.
  expect(userDirs).toHaveBeenCalledTimes(2);
});

test("a_new_window_opens_the_new_tab_folder_when_one_is_set", async () => {
  settingsGet.mockImplementation(() =>
    Promise.resolve({ ...STORED, new_tab_folder: { k: "Utf8", v: "/srv/work" } })
  );
  render(<App />);
  expect(await screen.findByRole("tab", { name: "work" })).toBeInTheDocument();
  expect(useTabs.getState().tabs).toHaveLength(1);
});

test("settings_that_cannot_be_read_open_home_and_say_why", async () => {
  settingsGet.mockImplementation(() => Promise.reject({ kind: "Io", message: "unreadable" }));
  render(<App />);
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  const said = await screen.findByText(/settings could not be read, so Home opened/);
  expect(said).toHaveTextContent("unreadable");
});
