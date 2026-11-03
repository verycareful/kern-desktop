// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DirEvent, WireEntry, WireError, WirePath } from "../ipc";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  fileIdentity: vi.fn(),
  openPaths: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
// The worker a large listing is sorted in does not exist in jsdom: sort in place.
vi.mock("./sort-async", async () => {
  const { sortEntries } = await import("./sort");
  return {
    SORT_IN_WORKER_ABOVE: 5000,
    createSorter: () => ({
      sort: (e: WireEntry[], by: "name", dir: "asc") => Promise.resolve(sortEntries(e, by, dir)),
      dispose: () => undefined,
    }),
  };
});

import { FolderTree } from "./FolderTree";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const file = (dir: string, name: string): WireEntry => entry(name, {}, dir);
const folder = (dir: string, name: string): WireEntry =>
  entry(name, { kind: "dir", target_is_dir: true }, dir);
const link = (dir: string, name: string): WireEntry =>
  entry(name, { kind: "symlink", target_is_dir: true }, dir);
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

/** The folders the mock listing knows, by path text. */
let disk: Record<string, WireEntry[]>;
let handlers: Record<string, (payload: DirEvent) => void>;
const ROOT = p("/r");

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubLayout();
  handlers = {};
  disk = {
    "/r": [folder("/r", "docs"), folder("/r", "src"), file("/r", "readme.md"), file("/r", "z.txt")],
    "/r/docs": [file("/r/docs", "a.txt"), folder("/r/docs", "deep")],
    "/r/docs/deep": [file("/r/docs/deep", "d.txt")],
    "/r/src": [file("/r/src", "main.rs")],
  };
  ipc.listDir.mockImplementation((path: WirePath) => {
    const e = disk[path.v];
    return e ? Promise.resolve([...e].reverse()) : Promise.reject(wireError("NotFound"));
  });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.fileIdentity.mockImplementation((paths: WirePath[]) =>
    Promise.resolve(paths.map((q) => ({ state: "known", dev: "1", ino: q.v })))
  );
  ipc.openPaths.mockResolvedValue([]);
  ipc.on.mockImplementation((name: string, h: (payload: DirEvent) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  vi.clearAllMocks();
});

const rows = () => screen.queryAllByTestId("tree-row");
const names = () => rows().map((r) => r.getAttribute("data-name"));
const row = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name}`) });
const emit = (name: string, payload: DirEvent) => act(async () => handlers[name]?.(payload));

async function mount(over: Partial<React.ComponentProps<typeof FolderTree>> = {}) {
  const view = render(<FolderTree root={ROOT} hidden={false} treeId="t" {...over} />);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  return view;
}

test("tree_expands_lazily_and_unwatches_on_collapse", async () => {
  await mount();
  // Only the root is listed and watched; folders come in order (folders first, then files).
  expect(names()).toEqual(["docs", "src", "readme.md", "z.txt"]);
  expect(ipc.listDir.mock.calls.map((c) => c[0].v)).toEqual(["/r"]);
  expect(ipc.watchDir).toHaveBeenCalledExactlyOnceWith("tree:t:Utf8:/r", ROOT);

  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("a.txt"));
  expect(names()).toEqual(["docs", "deep", "a.txt", "src", "readme.md", "z.txt"]);
  expect(ipc.listDir.mock.calls.map((c) => c[0].v)).toEqual(["/r", "/r/docs"]);
  expect(ipc.watchDir).toHaveBeenLastCalledWith("tree:t:Utf8:/r/docs", p("/r/docs"));
  expect(row("docs")).toHaveAttribute("aria-expanded", "true");
  expect(row("src")).toHaveAttribute("aria-expanded", "false");

  // Closing it drops its watch, and what was below it.
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toEqual(["docs", "src", "readme.md", "z.txt"]));
  await waitFor(() =>
    expect(ipc.unwatchDir).toHaveBeenCalledExactlyOnceWith("tree:t:Utf8:/r/docs")
  );

  // Opened again it is listed again: nothing watched it meanwhile.
  disk["/r/docs"] = [file("/r/docs", "new.txt")];
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("new.txt"));
  expect(ipc.listDir.mock.calls.filter((c) => c[0].v === "/r/docs")).toHaveLength(2);
});

test("closing_a_folder_ends_the_watches_of_the_folders_open_below_it", async () => {
  await mount();
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("deep"));
  fireEvent.click(row("deep"));
  await waitFor(() => expect(names()).toContain("d.txt"));
  expect(ipc.watchDir).toHaveBeenCalledTimes(3);
  fireEvent.click(row("docs"));
  await waitFor(() => expect(ipc.unwatchDir).toHaveBeenCalledTimes(2));
  expect(ipc.unwatchDir.mock.calls.map((c) => c[0]).sort()).toEqual([
    "tree:t:Utf8:/r/docs",
    "tree:t:Utf8:/r/docs/deep",
  ]);
});

test("the_tree_ends_every_watch_it_placed_when_it_goes", async () => {
  const view = await mount();
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("a.txt"));
  view.unmount();
  await waitFor(() => expect(ipc.unwatchDir).toHaveBeenCalledTimes(2));
});

test("tree_100k_rows_virtualised", async () => {
  disk["/r"] = Array.from({ length: 100_000 }, (_, i) =>
    file("/r", `file${String(i).padStart(6, "0")}.txt`)
  );
  await mount();
  // 100 000 rows exist, a screenful is in the page.
  const drawn = rows().length;
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThanOrEqual(200);
  const body = screen.getByRole("tree").firstElementChild as HTMLElement;
  expect(body.style.height).toBe(`${100_000 * 28}px`);
  // The last row is reachable from the keyboard, and the page still holds a screenful.
  const tree = screen.getByRole("tree");
  fireEvent.keyDown(tree, { key: "End" });
  expect(tree.getAttribute("aria-activedescendant")).toMatch(/-row-99999$/);
  expect(rows().length).toBeLessThanOrEqual(200);
});

test("vanished_expanded_folder_collapses", async () => {
  await mount();
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("deep"));
  fireEvent.click(row("deep"));
  await waitFor(() => expect(names()).toContain("d.txt"));
  // docs is deleted: its watch ends, the listing finds nothing.
  delete disk["/r/docs"];
  delete disk["/r/docs/deep"];
  disk["/r"] = disk["/r"]!.filter((e) => e.name !== "docs");
  await emit("kernkraft://dir-gone", { key: "tree:t:Utf8:/r/docs" });
  await waitFor(() => expect(names()).not.toContain("a.txt"));
  // Closed with a note, never shown stale, and the folders below it go with it.
  expect(names()).not.toContain("d.txt");
  expect(screen.getByRole("status", { name: "Notes about the folder tree" })).toHaveTextContent(
    "/r/docs is gone, so it was closed."
  );
  await waitFor(() =>
    expect(ipc.unwatchDir.mock.calls.map((c) => c[0])).toContain("tree:t:Utf8:/r/docs/deep")
  );
});

test("a_folder_that_is_gone_when_a_change_is_noticed_is_closed_too", async () => {
  await mount();
  fireEvent.click(row("src"));
  await waitFor(() => expect(names()).toContain("main.rs"));
  delete disk["/r/src"];
  await emit("kernkraft://dir-changed", { key: "tree:t:Utf8:/r/src" });
  await waitFor(() => expect(names()).not.toContain("main.rs"));
  expect(screen.getByRole("status")).toHaveTextContent("/r/src is gone");
  expect(row("src")).toHaveAttribute("aria-expanded", "false");
});

test("a_folder_replaced_in_place_stays_open_and_is_watched_again", async () => {
  await mount();
  fireEvent.click(row("src"));
  await waitFor(() => expect(names()).toContain("main.rs"));
  disk["/r/src"] = [file("/r/src", "lib.rs")];
  await emit("kernkraft://dir-gone", { key: "tree:t:Utf8:/r/src" });
  await waitFor(() => expect(names()).toContain("lib.rs"));
  await waitFor(() =>
    expect(ipc.watchDir.mock.calls.filter((c) => c[0].endsWith("/r/src"))).toHaveLength(2)
  );
});

test("a_change_lists_the_folder_again_and_another_trees_events_are_ignored", async () => {
  await mount();
  fireEvent.click(row("src"));
  await waitFor(() => expect(names()).toContain("main.rs"));
  disk["/r/src"] = [file("/r/src", "main.rs"), file("/r/src", "new.rs")];
  await emit("kernkraft://dir-changed", { key: "tree:other:Utf8:/r/src" });
  expect(names()).not.toContain("new.rs");
  await emit("kernkraft://dir-changed", { key: "tree:t:Utf8:/r/src" });
  await waitFor(() => expect(names()).toContain("new.rs"));
});

test("a_watch_that_cannot_be_set_is_said_in_the_tree_beside_the_folder", async () => {
  ipc.watchDir.mockImplementation((key: string) =>
    key.endsWith("/r/src")
      ? Promise.reject(wireError("Watch", "no inotify watches left"))
      : Promise.resolve()
  );
  await mount();
  fireEvent.click(row("src"));
  await waitFor(() => expect(names()).toContain("main.rs"));
  const note = await screen.findByText(/Changes in this folder will not show: Watch: no inotify/);
  // It stands directly under the folder it is about; the listing still shows.
  const all = screen.getAllByTestId(/tree-(row|note)/);
  expect(all.indexOf(note.closest("[data-testid]") as HTMLElement)).toBe(
    all.indexOf(row("src")) + 1
  );
});

test("a_folder_that_cannot_be_listed_shows_its_error_in_place", async () => {
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/r/src"
      ? Promise.reject(wireError("PermissionDenied", "permission denied"))
      : Promise.resolve(disk[path.v] ?? [])
  );
  await mount();
  fireEvent.click(row("src"));
  expect(await screen.findByText("PermissionDenied: permission denied")).toBeInTheDocument();
  // It stays open with the reason, and is not reported as gone.
  expect(row("src")).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("status")).toBeNull();
});

test("hidden_items_follow_the_window_choice", async () => {
  ipc.listDir.mockImplementation((path: WirePath, hidden: boolean) =>
    Promise.resolve(
      path.v === "/r" ? [file("/r", "a.txt"), ...(hidden ? [file("/r", ".secret")] : [])] : []
    )
  );
  const view = await mount();
  expect(names()).toEqual(["a.txt"]);
  expect(ipc.listDir).toHaveBeenLastCalledWith(ROOT, false);
  view.rerender(<FolderTree root={ROOT} hidden treeId="t" />);
  await waitFor(() => expect(names()).toEqual([".secret", "a.txt"]));
  expect(ipc.listDir).toHaveBeenLastCalledWith(ROOT, true);
  // The same watch stays.
  expect(ipc.watchDir).toHaveBeenCalledTimes(1);
});

test("a_link_back_to_a_folder_above_is_shown_as_a_loop_and_is_not_listed", async () => {
  disk["/r/docs"] = [link("/r/docs", "up")];
  // The link leads to /r, which is the root.
  ipc.fileIdentity.mockImplementation((paths: WirePath[]) =>
    Promise.resolve(
      paths.map((q) => ({ state: "known", dev: "1", ino: q.v === "/r/docs/up" ? "/r" : q.v }))
    )
  );
  await mount();
  fireEvent.click(row("docs"));
  const up = await screen.findByRole("treeitem", { name: /^up/ });
  fireEvent.click(up);
  await waitFor(() => expect(up).toHaveTextContent(/leads back to a folder above it/));
  expect(ipc.listDir.mock.calls.map((c) => c[0].v)).not.toContain("/r/docs/up");
  expect(up).not.toHaveAttribute("aria-expanded");
  // The identities were asked in one call: the branch from the root, then the link.
  expect(ipc.fileIdentity).toHaveBeenCalledExactlyOnceWith([
    p("/r"),
    p("/r/docs"),
    p("/r/docs/up"),
  ]);
});

test("a_link_to_a_folder_that_is_not_above_it_opens_like_a_folder", async () => {
  disk["/r/docs"] = [link("/r/docs", "to-src")];
  disk["/r/docs/to-src"] = [file("/r/docs/to-src", "x.rs")];
  await mount();
  fireEvent.click(row("docs"));
  fireEvent.click(await screen.findByRole("treeitem", { name: /^to-src/ }));
  await waitFor(() => expect(names()).toContain("x.rs"));
  expect(ipc.watchDir.mock.calls.map((c) => c[0])).toContain("tree:t:Utf8:/r/docs/to-src");
});

test("a_link_whose_identity_cannot_be_told_is_not_opened_and_says_why", async () => {
  disk["/r/docs"] = [link("/r/docs", "odd")];
  ipc.fileIdentity.mockResolvedValue([
    { state: "known", dev: "1", ino: "a" },
    { state: "known", dev: "1", ino: "b" },
    { state: "failed", error: wireError("PermissionDenied", "no access") },
  ]);
  await mount();
  fireEvent.click(row("docs"));
  fireEvent.click(await screen.findByRole("treeitem", { name: /^odd/ }));
  expect(await screen.findByText(/could not tell whether this link leads back/)).toHaveTextContent(
    /PermissionDenied: no access/
  );
  expect(ipc.listDir.mock.calls.map((c) => c[0].v)).not.toContain("/r/docs/odd");
});

test("a_file_opens_as_the_folder_view_opens_it_and_a_failure_is_said", async () => {
  await mount();
  fireEvent.click(row("readme.md"));
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([p("/r/readme.md")], "inside", "default")
  );
  expect(row("readme.md")).toHaveAttribute("aria-selected", "true");
  ipc.openPaths.mockResolvedValue([
    { path: p("/r/z.txt"), action: "failed", location: null, error: wireError("NotFound", "gone") },
  ]);
  fireEvent.click(row("z.txt"));
  expect(await screen.findByText(/z\.txt: .*gone/)).toBeInTheDocument();
});

test("a_name_that_is_not_utf8_is_listed_and_opened_by_its_real_path", async () => {
  const bytes: WirePath = { k: "Bytes", v: btoa("/r/caf\xe9") };
  disk["/r"] = [entry("caf�", { kind: "dir", target_is_dir: true, path: bytes })];
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(path.k === "Bytes" ? [file("/r/caf", "inside.txt")] : disk["/r"]!)
  );
  await mount();
  fireEvent.click(row("caf"));
  await waitFor(() => expect(names()).toContain("inside.txt"));
  expect(ipc.listDir).toHaveBeenLastCalledWith(bytes, false);
  expect(ipc.watchDir).toHaveBeenLastCalledWith(`tree:t:Bytes:${bytes.v}`, bytes);
});

test("the_root_being_gone_offers_the_nearest_folder_above_it", async () => {
  const onRootGone = vi.fn();
  delete disk["/r"];
  disk["/"] = [];
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/" ? Promise.resolve([]) : Promise.reject(wireError("NotFound"))
  );
  render(<FolderTree root={ROOT} hidden={false} treeId="t" onRootGone={onRootGone} />);
  await waitFor(() => expect(onRootGone).toHaveBeenCalledExactlyOnceWith(p("/")));
  expect(screen.getByText("NotFound: NotFound")).toBeInTheDocument();
});

test("a_new_root_starts_a_new_tree_and_ends_the_old_watch", async () => {
  disk["/q"] = [file("/q", "q.txt")];
  const view = await mount();
  view.rerender(<FolderTree root={p("/q")} hidden={false} treeId="t" />);
  await waitFor(() => expect(names()).toEqual(["q.txt"]));
  expect(ipc.unwatchDir).toHaveBeenCalledWith("tree:t:Utf8:/r");
  expect(ipc.watchDir).toHaveBeenLastCalledWith("tree:t:Utf8:/q", p("/q"));
});

// ---- the keyboard, WAI-ARIA tree view ----

test("the_tree_is_an_aria_tree_with_levels_and_sibling_counts", async () => {
  await mount();
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("a.txt"));
  const tree = screen.getByRole("tree");
  expect(tree).toHaveAccessibleName("Folders of r");
  const a = row("a.txt");
  expect(a).toHaveAttribute("aria-level", "2");
  expect(a).toHaveAttribute("aria-posinset", "2");
  expect(a).toHaveAttribute("aria-setsize", "2");
  expect(row("docs")).toHaveAttribute("aria-level", "1");
  expect(row("docs")).toHaveAttribute("aria-setsize", "4");
  expect(row("z.txt")).not.toHaveAttribute("aria-expanded");
});

test("tree_keyboard_navigation_in_the_page", async () => {
  await mount();
  const tree = screen.getByRole("tree");
  tree.focus();
  const key = (k: string) => fireEvent.keyDown(tree, { key: k });
  const current = () =>
    document.getElementById(tree.getAttribute("aria-activedescendant") ?? "")?.dataset.name;

  key("ArrowDown");
  expect(current()).toBe("docs");
  key("ArrowRight"); // opens
  await waitFor(() => expect(names()).toContain("a.txt"));
  expect(current()).toBe("docs");
  key("ArrowRight"); // enters
  expect(current()).toBe("deep");
  key("ArrowDown");
  expect(current()).toBe("a.txt");
  key("ArrowLeft"); // to the parent
  expect(current()).toBe("docs");
  key("ArrowLeft"); // closes
  await waitFor(() => expect(names()).not.toContain("a.txt"));
  key("End");
  expect(current()).toBe("z.txt");
  key("Home");
  expect(current()).toBe("docs");
  // Type-ahead: "r" goes to readme.md, which Enter opens.
  fireEvent.keyDown(tree, { key: "r" });
  expect(current()).toBe("readme.md");
  key("Enter");
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/r/readme.md")], "inside", "default")
  );
  // Enter on a folder toggles it.
  key("Home");
  key("Enter");
  await waitFor(() => expect(names()).toContain("a.txt"));
});

test("closing_a_folder_that_holds_the_current_row_moves_it_to_the_folder", async () => {
  await mount();
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).toContain("a.txt"));
  fireEvent.click(row("a.txt"));
  expect(row("a.txt")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(row("docs"));
  await waitFor(() => expect(names()).not.toContain("a.txt"));
  expect(row("docs")).toHaveAttribute("aria-selected", "true");
});

test("the_current_row_shows_the_keyboard_only_while_the_tree_has_it", async () => {
  await mount();
  const tree = screen.getByRole("tree");
  tree.focus();
  fireEvent.keyDown(tree, { key: "ArrowDown" });
  expect(row("docs")).toHaveClass("kern-cursor");
  fireEvent.blur(tree);
  expect(row("docs")).not.toHaveClass("kern-cursor");
  expect(row("docs")).toHaveClass("kern-selected");
});

test("a_right_click_or_the_menu_key_reports_the_entry_and_the_empty_part", async () => {
  const onContextMenu = vi.fn();
  await mount({ onContextMenu });
  fireEvent.contextMenu(row("src"), { clientX: 10, clientY: 20 });
  expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ name: "src" }), 10, 20);
  expect(row("src")).toHaveAttribute("aria-selected", "true");
  fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 1, clientY: 2 });
  expect(onContextMenu).toHaveBeenLastCalledWith(null, 1, 2);
  // The Menu key opens it at the bottom left of the current row (stubLayout gives every box 800 by 600).
  fireEvent.keyDown(screen.getByRole("tree"), { key: "ContextMenu" });
  expect(onContextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ name: "src" }), 0, 600);
});

test("a_note_can_be_dismissed", async () => {
  await mount();
  fireEvent.click(row("src"));
  await waitFor(() => expect(names()).toContain("main.rs"));
  delete disk["/r/src"];
  await emit("kernkraft://dir-changed", { key: "tree:t:Utf8:/r/src" });
  const notes = await screen.findByRole("status");
  fireEvent.click(within(notes).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
});
