// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useUserDirs } from "./user-dirs-store";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import type { WirePath } from "../ipc";

const opened = vi.hoisted(() => ({ settings: [] as (string | undefined)[] }));

// The places strip looks the user's folders and the volumes up.
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  userDirs: () => Promise.resolve({ home: { k: "Utf8", v: "/home/a" }, dirs: [] }),
  volumesList: () => Promise.resolve({ mounted: [], unmounted: [], problems: [] }),
  volumesProblemsTake: () => Promise.resolve([]),
  on: () => Promise.resolve(() => undefined),
  // The window reads the undo history once.
  undoState: () => Promise.resolve({ undo: null, redo: null }),
  // Pinned and Recent read the pins and recents.
  prune: async () => (await import("./test-pinned-recent")).EMPTY_PRUNE,
  pinsGet: async () => ({ entries: [] }),
  storeErrorsTake: () => Promise.resolve([]),
  // A document tab's editor opens its file and registers it.
  textOpen: (path: WirePath) =>
    Promise.resolve({
      path,
      text: "hello",
      ending: "lf",
      bom: false,
      read_only: null,
      stamp: "s1:5:0:1:1:0",
    }),
  textCheck: () => Promise.resolve("same"),
  textSave: () => Promise.resolve("s1:6:0:1:1:1"),
  // Settings opens in a window of its own.
  openSettings: (section?: string) => {
    opened.settings.push(section);
    return Promise.resolve();
  },
  settingsGet: async () => (await import("../settings/test-settings")).SETTINGS,
  layoutGet: async () => (await import("../settings/test-settings")).NO_LAYOUT,
  defaultFmStatus: () => Promise.resolve({ is_default: true, current: null }),
  fm1Status: () => Promise.resolve({ owned: true, owner: null, reason: null }),
  recentTouch: () => Promise.resolve({ entries: [] }),
  docOpened: () => Promise.resolve(),
  docClosed: () => Promise.resolve(),
}));
import { actions, appliesTo } from "../keys/actions";
import { usePanelsStore } from "../store/panels";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import MainWindow from "./MainWindow";
import { VOLUME_MENU } from "./volume-menu";
import { ENTRY_MENU } from "./entry-menu";
import { TREE_MENU } from "../files/tree-menu";
import { usePinnedRecent } from "./pinned-recent-store";
import { useCloseGuard } from "./useCloseGuard";
import { useOps } from "../ops/useOps";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useUserDirs.getState().reset();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  // The window draws a layout once its stored one is read (main-layout-wait.test.tsx).
  useLayout.setState({ loaded: true });
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

test("tab_row_sits_over_the_folder_area_only", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  // The places strip and the side panel run from the window top, the tab
  // row sits over the folder area. All four are cells of one grid (the boxes
  // are asserted in the Playwright smoke test); the status bar is outside the
  // grid, so it spans the whole bottom.
  const main = screen.getByTestId("main-grid");
  expect(main).toHaveAttribute("data-layout", "folder");
  expect(screen.getByTestId("tab-bar").parentElement).toBe(main);
  expect(screen.getByTestId("places-strip").parentElement).toBe(main);
  expect(screen.getByTestId("folder-area").parentElement).toBe(main);
  expect(screen.getByTestId("side-panel").parentElement).toBe(main);
  expect(main).not.toContainElement(screen.getByTestId("status-bar"));
  // The strip's top slot, level with the tab row, holds Kern's logo: the first thing in the strip.
  const slot = screen.getByTestId("places-strip").firstElementChild as HTMLElement;
  expect(slot).toHaveClass("kern-places-slot");
  expect(within(slot).getByRole("button", { name: "About Kern" })).toBeInTheDocument();
});

test("the_logo_opens_the_settings_window_at_about", () => {
  opened.settings.length = 0;
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  fireEvent.click(screen.getByRole("button", { name: "About Kern" }));
  expect(opened.settings).toEqual(["about"]);
  // No tab is made for it.
  expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
});

test("the_main_window_strip_offers_the_library_and_its_tab_is_titled_so", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  const strip = screen.getByTestId("places-strip");
  expect(within(strip).queryByRole("button", { name: "All documents" })).toBeNull();
  fireEvent.click(within(strip).getByRole("button", { name: "Library" }));
  expect(screen.getByRole("tab", { name: "Library" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "All documents" })).toBeNull();
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

test("a_window_showing_only_a_document_follows_pinned_and_recent", async () => {
  // The panel is folded away, yet Ctrl+D there needs to know whether the document is pinned.
  useTabs.getState().openDoc(p("/home/a/n.md"));
  const { unmount } = render(<MainWindow />);
  expect(screen.queryByTestId("pinned")).toBeNull();
  await waitFor(() => expect(usePinnedRecent.getState().pins).toEqual([]));
  unmount();
});

test("doc_tab_status_makes_no_saved_claim", () => {
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a/n.md");
  expect(screen.queryByTestId("status-dirty")).toBeNull();
  expect(screen.getByTestId("status-bar")).not.toHaveTextContent("Saved");
});

test("each_document_tab_keeps_its_editor_and_unsaved_text_while_another_tab_is_shown", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  const view = EditorView.findFromDOM(host)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "kept " } }));
  expect(screen.getByTestId("status-dirty")).toBeInTheDocument();

  // The folder tab is shown: the document is hidden, not torn down.
  fireEvent.click(screen.getAllByRole("tab")[0]!);
  expect(screen.getByTestId("main-grid")).toHaveAttribute("data-layout", "folder");
  expect(screen.getByTestId("text-editor")).not.toBeVisible();
  expect(screen.queryByTestId("stub-left")).toBeNull();
  expect(useTabs.getState().tabs[1]).toMatchObject({ dirty: true });

  fireEvent.click(screen.getAllByRole("tab")[1]!);
  expect(screen.getByTestId("text-editor")).toBeVisible();
  expect(EditorView.findFromDOM(screen.getByTestId("editor-host"))).toBe(view);
  expect(view.state.doc.toString()).toBe("kept hello");
});

test("close_dirty_tab_prompts", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  act(() => EditorView.findFromDOM(host)!.dispatch({ changes: { from: 0, insert: "x" } }));

  // The close button asks; Cancel keeps the tab and its text.
  fireEvent.click(screen.getByRole("button", { name: "Close n.md" }));
  const prompt = await screen.findByTestId("close-prompt");
  expect(prompt).toHaveTextContent("Save the changes to n.md before closing?");
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByTestId("close-prompt")).toBeNull();
  expect(useTabs.getState().tabs).toHaveLength(2);

  // Close without saving drops it.
  fireEvent.click(screen.getByRole("button", { name: "Close n.md" }));
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", {
      name: "Close without saving",
    })
  );
  await waitFor(() => expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["folder"]));
});

test("save_in_the_close_question_writes_then_closes", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  act(() => EditorView.findFromDOM(host)!.dispatch({ changes: { from: 0, insert: "x" } }));
  fireEvent.click(screen.getByRole("button", { name: "Close n.md" }));
  fireEvent.click(
    within(await screen.findByTestId("close-prompt")).getByRole("button", { name: "Save" })
  );
  await waitFor(() => expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["folder"]));
  expect(screen.getByTestId("status-notice")).toHaveTextContent("Saved n.md");
});

test("two_notices_at_once_are_both_in_the_status_bar", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  act(() => {
    useOps.getState().notify("The recent list could not be updated.");
    useOps.getState().notify("n.md could not be registered as open.");
  });
  const notice = screen.getByTestId("status-notice");
  expect(notice).toHaveTextContent("The recent list could not be updated.");
  expect(notice).toHaveTextContent("n.md could not be registered as open.");
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
  useTabs.getState().openTrash();
  useTabs.getState().openDocuments();
  render(<MainWindow />);
  for (const tabName of ["a", "n.md", "Trash", "Library"]) {
    fireEvent.click(screen.getByRole("tab", { name: tabName }));
    fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
    const menu = screen.getByTestId("action-menu");
    collect();
    // Exactly the actions that apply here, each showing its shortcut, grouped by area.
    const active = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!;
    const applicable = actions.filter(
      (a) =>
        a.menu !== false &&
        a.when !== "volume" &&
        a.when !== "entry" &&
        a.when !== "tree" &&
        appliesTo(a, active)
    );
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(applicable.length);
    for (const a of applicable) {
      const item = menu.querySelector(`[data-action-id="${a.id}"]`);
      expect(item, a.id).not.toBeNull();
      if (a.keys[0]) expect(item).toHaveTextContent(a.keys[0]);
    }
    expect(within(menu).getAllByRole("group").length).toBeGreaterThan(1);
    fireEvent.keyDown(menu, { key: "Escape" });
  }
  // The volume actions are in the volume's own menu (right-click, Menu key), not the main one.
  for (const section of VOLUME_MENU) for (const a of section.actions) seen.add(a.id);
  // The entry actions are in the menu of an entry of Pinned or Recent.
  for (const section of ENTRY_MENU) for (const a of section.actions) seen.add(a.id);
  // The tree actions are in the folder tree's own menu.
  for (const section of TREE_MENU) for (const a of section.actions) seen.add(a.id);
  // The rest are buttons of the top bar (actions.test.ts checks each has a key or is About).
  for (const a of actions) if (a.menu === false) seen.add(a.id);
  expect([...seen].sort()).toEqual(actions.map((a) => a.id).sort());
});

test("modified_arrows_on_a_focused_tab_are_not_tab_navigation", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openFolder(p("/home/a/b"), false);
  useTabs.getState().openFolder(p("/home/c"), true);
  useTabs.getState().activate(useTabs.getState().tabs[0]!.id);
  render(<MainWindow />);
  const tab = screen.getByRole("tab", { name: "b" });
  tab.focus();
  const active = useTabs.getState().activeId;
  // Alt+Left is the Back shortcut: history goes back, the tab stays active.
  fireEvent.keyDown(tab, { key: "ArrowLeft", altKey: true });
  expect(useTabs.getState().activeId).toBe(active);
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a");
  // The close button is not a tab: arrows there do nothing to the tabs.
  fireEvent.keyDown(screen.getByRole("button", { name: "Close a" }), { key: "ArrowRight" });
  expect(useTabs.getState().activeId).toBe(active);
});

test("the_tab_row_has_the_new_tab_buttons_settings_and_the_menu", async () => {
  useTabs.getState().openFolder(p("/home/a/work"), false);
  render(<MainWindow />);
  const row = screen.getByTestId("tab-bar");
  const newTab = within(row).getByRole("button", { name: "New tab" });
  expect(newTab).toHaveAttribute("title", "New tab (Ctrl+T)");
  expect(within(row).getByRole("button", { name: "New tab here" })).toHaveAttribute(
    "title",
    "New tab here (Ctrl+Shift+T)"
  );
  expect(within(row).getByRole("button", { name: "Open Settings" })).toHaveAttribute(
    "title",
    "Open Settings (Ctrl+,)"
  );
  expect(within(row).getByRole("button", { name: "Main menu" })).toBeInTheDocument();
  // Navigation is the folder's, in its toolbar.
  expect(within(row).queryByRole("button", { name: "Back" })).toBeNull();
  // New tab waits for the settings, then opens Home in front.
  await waitFor(() => expect(newTab).toBeEnabled());
  fireEvent.click(newTab);
  await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2));
  const added = useTabs.getState().tabs[1]!;
  expect(added.kind === "folder" && added.path.v).toBe("/home/a");
  expect(useTabs.getState().activeId).toBe(added.id);
  fireEvent.click(within(row).getByRole("button", { name: "Open Settings" }));
  await waitFor(() => expect(opened.settings).toContain(undefined));
});

test("the_folder_toolbar_shows_on_a_folder_tab_only", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  render(<MainWindow />);
  // The document tab is in front: no folder toolbar.
  expect(screen.queryByRole("toolbar", { name: "Folder" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "a" }));
  const bar = await screen.findByRole("toolbar", { name: "Folder" });
  for (const name of [
    "Back",
    "Forward",
    "Up one folder",
    "New folder",
    "Search",
    "Open terminal here",
    "List view",
    "Grid view",
    "Show or hide hidden files",
    "Open as editor",
  ]) {
    expect(within(bar).getByRole("button", { name }), name).toBeInTheDocument();
  }
  expect(within(bar).getByRole("button", { name: "Up one folder" })).toHaveAttribute(
    "title",
    "Up one folder (Alt+ArrowUp)"
  );
  expect(within(bar).getByRole("button", { name: "Show or hide hidden files" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("the_main_menu_has_no_interface_size_and_no_about", () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  render(<MainWindow />);
  fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
  const menu = screen.getByTestId("action-menu");
  for (const name of [/interface/i, /About Kern/, /Open Settings/, /^Back/, /New folder/]) {
    expect(within(menu).queryByRole("menuitem", { name }), String(name)).toBeNull();
  }
  expect(within(menu).getByRole("menuitem", { name: /Open as editor/ })).toBeInTheDocument();
});
