// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import MainWindow from "./MainWindow";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});

test("folder_tab_shows_three_regions", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  expect(screen.getByTestId("places-strip")).toBeInTheDocument();
  expect(screen.getByTestId("folder-area")).toBeInTheDocument();
  const side = screen.getByTestId("side-panel");
  expect(within(side).getByTestId("pinned")).toBeInTheDocument();
  expect(within(side).getByTestId("recent")).toBeInTheDocument();
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a");
  expect(screen.queryByTestId("stub-left")).toBeNull();
  expect(screen.queryByTestId("stub-right")).toBeNull();
});

test("doc_tab_shows_two_stubs", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  expect(screen.getByTestId("doc-area")).toBeInTheDocument();
  expect(screen.getByTestId("stub-left")).toBeInTheDocument();
  expect(screen.getByTestId("stub-right")).toBeInTheDocument();
  expect(screen.queryByTestId("places-panel")).toBeNull();
  expect(screen.queryByTestId("side-panel")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "File manager panel" }));
  expect(screen.getByTestId("places-panel")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pinned and Recent panel" }));
  expect(screen.getByTestId("side-panel")).toBeInTheDocument();

  // Returning to the folder tab shows both as docked panels, no stubs.
  fireEvent.click(screen.getAllByRole("tab")[0]!);
  expect(screen.queryByTestId("stub-left")).toBeNull();
  expect(screen.getByTestId("side-panel")).toBeInTheDocument();
});

test("tab_bar_buttons_and_menu_follow_the_action_table", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openFolder(p("/home/a/b"), false);
  render(<MainWindow />);
  const back = screen.getByRole("button", { name: "Back" });
  expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  fireEvent.click(back);
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a");
  expect(back).toBeDisabled();

  fireEvent.contextMenu(screen.getByRole("tab"));
  const menu = screen.getByTestId("action-menu");
  expect(within(menu).getByRole("menuitem", { name: /Close tab/ })).toHaveTextContent("Ctrl+W");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Close tab/ }));
  expect(screen.getByTestId("no-tab")).toBeInTheDocument();
  expect(screen.queryByTestId("action-menu")).toBeNull();
});

test("close_button_closes_its_tab", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  fireEvent.click(screen.getByRole("button", { name: "Close a" }));
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
});
