// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { render, screen, within } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { useViewSettings } from "../files/view-settings";
import { useTabs } from "../store/tabs";
import { EDITOR_WINDOW_KEYS } from "./EditorWindow";
import { TabBar } from "./TabBar";

// An editor window's tabs are documents of its folder: it has Settings and the menu, no new tabs.
// The keys on the new tab buttons follow the setting that swaps them.

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useViewSettings.setState({ loaded: true, newTabDefault: "folder" });
});

test("an_editor_window_has_settings_and_the_menu_but_no_new_tab_buttons", () => {
  useTabs.getState().openDoc(p("/w/n.md"));
  render(<TabBar allow={EDITOR_WINDOW_KEYS} />);
  const row = screen.getByTestId("tab-bar");
  expect(within(row).queryByRole("button", { name: "New tab" })).toBeNull();
  expect(within(row).queryByRole("button", { name: "New tab here" })).toBeNull();
  expect(within(row).getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Main menu" })).toBeInTheDocument();
});

test("the_new_tab_buttons_show_the_keys_the_setting_gives_them", () => {
  useTabs.getState().openFolder(p("/w"), false);
  useViewSettings.setState({ newTabDefault: "current" });
  render(<TabBar />);
  expect(screen.getByRole("button", { name: "New tab" })).toHaveAttribute(
    "title",
    "New tab (Ctrl+Shift+T)"
  );
  expect(screen.getByRole("button", { name: "New tab here" })).toHaveAttribute(
    "title",
    "New tab here (Ctrl+T)"
  );
});
