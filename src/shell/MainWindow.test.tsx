import { fireEvent, render, screen, within } from "@testing-library/react";
import type { WirePath } from "../ipc";
import { actions, appliesTo } from "../keys/actions";
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

test("tab_row_sits_over_the_left_two_thirds_only", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  // Design 4.1: the right third runs from the window top, so the side panel is
  // a sibling of the tab row and the places panel, not inside either; the
  // status bar is outside the grid that holds them (it spans the whole bottom).
  const main = screen.getByTestId("main-grid");
  expect(main).toHaveAttribute("data-layout", "folder");
  expect(screen.getByTestId("tab-bar").parentElement).toBe(main);
  expect(screen.getByTestId("places-panel").parentElement).toBe(main);
  expect(screen.getByTestId("side-panel").parentElement).toBe(main);
  expect(main).not.toContainElement(screen.getByTestId("status-bar"));
});

test("doc_tab_shows_two_stubs", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  expect(screen.getByTestId("main-grid")).toHaveAttribute("data-layout", "doc");
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

test("doc_tab_status_makes_no_saved_claim", () => {
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a/n.md");
  expect(screen.queryByTestId("status-dirty")).toBeNull();
  expect(screen.getByTestId("status-bar")).not.toHaveTextContent("Saved");
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
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByTestId("action-menu")).toBeNull();
});

test("close_button_and_middle_click_close_their_tab", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openFolder(p("/home/b"), true);
  useTabs.getState().openFolder(p("/home/c"), true);
  render(<MainWindow />);
  fireEvent.click(screen.getByRole("button", { name: "Close a" }));
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  // Middle click on a background tab closes it and leaves the active tab alone.
  const active = useTabs.getState().activeId;
  fireEvent(
    screen.getByRole("tab", { name: "b" }),
    new MouseEvent("auxclick", { bubbles: true, button: 1 })
  );
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(useTabs.getState().activeId).toBe(active);
});

test("context_menu_on_a_background_tab_targets_it_without_activating", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openFolder(p("/home/b"), true);
  render(<MainWindow />);
  const active = useTabs.getState().activeId;
  fireEvent.contextMenu(screen.getByRole("tab", { name: "a" }));
  expect(useTabs.getState().activeId).toBe(active);
  fireEvent.click(screen.getByRole("menuitem", { name: /Close tab/ }));
  expect(screen.queryByRole("tab", { name: "a" })).toBeNull();
  expect(useTabs.getState().activeId).toBe(active);
});

test("arrow_keys_move_between_tabs", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openFolder(p("/home/b"), true);
  render(<MainWindow />);
  const [a, b] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
  expect(b).toHaveAttribute("aria-selected", "true");
  expect(b).toHaveAttribute("tabindex", "0");
  expect(a).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(b, { key: "ArrowLeft" });
  expect(a).toHaveAttribute("aria-selected", "true");
  expect(a).toHaveFocus();
  fireEvent.keyDown(a, { key: "ArrowLeft" }); // wraps
  expect(b).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(b, { key: "Home" });
  expect(a).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(a, { key: "End" });
  expect(b).toHaveAttribute("aria-selected", "true");
});

test("no_button_is_nested_inside_a_tab", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  expect(within(screen.getByRole("tab")).queryByRole("button")).toBeNull();
});

test("every_action_appears_in_a_menu", () => {
  const seen = new Set<string>();
  const collect = () => {
    for (const el of screen.getAllByRole("menuitem")) {
      seen.add(el.getAttribute("data-action-id") ?? "");
    }
  };
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  for (const tabName of ["a", "n.md"]) {
    fireEvent.click(screen.getByRole("tab", { name: tabName }));
    fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
    const menu = screen.getByTestId("action-menu");
    collect();
    // Exactly the actions that apply here, each showing its shortcut, grouped by area.
    const active = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!;
    const applicable = actions.filter((a) => appliesTo(a, active));
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(applicable.length);
    for (const a of applicable) {
      const item = menu.querySelector(`[data-action-id="${a.id}"]`);
      expect(item, a.id).not.toBeNull();
      if (a.keys[0]) expect(item).toHaveTextContent(a.keys[0]);
    }
    expect(within(menu).getAllByRole("group").length).toBeGreaterThan(1);
    fireEvent.keyDown(menu, { key: "Escape" });
  }
  expect([...seen].sort()).toEqual(actions.map((a) => a.id).sort());
});
