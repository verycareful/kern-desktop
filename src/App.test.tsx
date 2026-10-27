// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WireTheme } from "./ipc/kernkraft";
import App from "./App";
import { useTabs } from "./store/tabs";

const themeGet = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({ css: ":root{}", fallbacks: [], problems: [] } as unknown as WireTheme)
  )
);
const userDirs = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ home: { k: "Utf8", v: "/home/t" }, dirs: [] }))
);

vi.mock("./ipc", async () => ({
  ...(await import("./ipc/wire-path")),
  EVENT_THEME_CHANGED: "kernkraft://theme-changed",
  EVENT_SETTINGS_CHANGED: "kern://settings-changed",
  EVENT_DIR_CHANGED: "kernkraft://dir-changed",
  EVENT_DIR_GONE: "kernkraft://dir-gone",
  // The folder view of the Home tab: an empty folder.
  listDir: () => Promise.resolve([]),
  watchDir: () => Promise.resolve(),
  unwatchDir: () => Promise.resolve(),
  on: () => Promise.resolve(() => undefined),
  openPendingTake: () => Promise.resolve([]),
  EVENT_OPEN: "kern://open",
  EVENT_SELECT: "kern://select",
  EVENT_OPEN_ERROR: "kern://open-error",
  EVENT_PROPERTIES: "kern://properties",
  EVENT_ADOPT_DOC: "kern://adopt-doc",
  EVENT_ADOPT_CANCELLED: "kern://adopt-cancelled",
  EVENT_CLOSE_REQUESTED: "kern://close-requested",
  settingsGet: () =>
    Promise.resolve({
      follow: { colours: true, accent: true, fonts: true, radius: true },
      theme_mode: "system",
      accent: "slate",
      density: "cozy",
      show_hidden: false,
      view_mode: "list",
    }),
  themeGet,
  userDirs,
  toWireError: (e: unknown) => e,
}));

beforeEach(() => {
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
  expect(userDirs).toHaveBeenCalledTimes(2);
});

test("home_lookup_failure_shows_the_error_with_retry", async () => {
  userDirs.mockImplementationOnce(() => Promise.reject({ kind: "Io", message: "no home" }));
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("no home");
  expect(screen.queryByRole("tab")).toBeNull();
  // Neither the "opening" note nor an empty-state claim sits beside the failure.
  expect(screen.queryByText(/Opening the Home folder/)).toBeNull();
  expect(userDirs).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("tab", { name: "t" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  // Retry made one lookup, not two.
  expect(userDirs).toHaveBeenCalledTimes(2);
});
