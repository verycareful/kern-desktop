// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Pins, PruneReport, Recents, WirePath } from "../ipc";
import { useTabs } from "../store/tabs";
import { useViewSettings } from "../files/view-settings";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  prune: vi.fn(),
  storeErrorsTake: vi.fn(),
  mimeOf: vi.fn(),
  openPaths: vi.fn(),
  pin: vi.fn(),
  pinsGet: vi.fn(),
  unpin: vi.fn(),
  pinsReorder: vi.fn(),
  userDirs: vi.fn(),
  openEditor: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { usePinnedRecent } from "./pinned-recent-store";
import { useUserDirs } from "./user-dirs-store";
import { useStoreErrors } from "../store/store-errors";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FOLDERS = new Set(["/home/t/Invoices", "/home/t/Work", "/home/t/Docs"]);
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

/** The handlers the panel subscribed, by event name. */
let handlers: Record<string, (payload: unknown) => void>;

function report(pins: string[], recents: [string, number][] = [], removed: string[] = []) {
  return {
    pins_removed: removed.map(p),
    recents_removed: [],
    errors: [],
    corrupt: [],
    pins: { entries: pins.map(p) },
    recents: { entries: recents.map(([v, ms]) => ({ path: p(v), opened_ms: ms })) },
  } satisfies PruneReport;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  handlers = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.storeErrorsTake.mockResolvedValue([]);
  ipc.mimeOf.mockImplementation((path: WirePath) =>
    Promise.resolve({
      mime: FOLDERS.has(path.v) ? "inode/directory" : "text/plain",
      is_text: !FOLDERS.has(path.v),
    })
  );
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
  ipc.openPaths.mockImplementation((paths: WirePath[]) =>
    Promise.resolve(paths.map((path) => ({ path, action: "doc_tab", location: null, error: null })))
  );
  ipc.pinsReorder.mockImplementation((paths: WirePath[]) =>
    Promise.resolve({ entries: paths } satisfies Pins)
  );
  usePinnedRecent.getState().reset();
  useStoreErrors.getState().reset();
  useUserDirs.getState().reset();
  useTabs.setState({ tabs: [], activeId: null });
});
afterEach(() => {
  cleanup();
  useViewSettings.setState({ singleClick: false });
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function shown(pins: string[], recents: [string, number][] = []) {
  ipc.prune.mockResolvedValue(report(pins, recents));
  render(<PinnedRecentPanel />);
  const pinned = screen.getByTestId("pinned");
  if (pins.length > 0) await within(pinned).findByText(pins[0]!.split("/").pop()!);
  await waitFor(() => expect(ipc.userDirs).toHaveBeenCalled());
  return { pinned, recent: screen.getByTestId("recent") };
}

const pinRows = () =>
  within(screen.getByTestId("pinned"))
    .getAllByRole("button")
    .map((b) => b.querySelector(".kern-place-label")?.textContent);

test("pin_shows_parent", async () => {
  const { pinned } = await shown(["/home/t/Uni/thesis.docx", "/srv/Invoices"]);
  const thesis = within(pinned).getByText("thesis.docx").closest("button")!;
  await waitFor(() => expect(within(thesis).getByText("~/Uni")).toBeTruthy());
  expect(within(pinned).getByText("/srv")).toBeTruthy();
  expect(thesis.title).toBe("/home/t/Uni/thesis.docx");
});

test("recent_shows_relative_time", async () => {
  const { recent } = await shown(
    [],
    [
      ["/home/t/report.docx", NOW - 2 * 60_000],
      ["/home/t/lease.pdf", NOW - 24 * 3_600_000],
    ]
  );
  await within(recent).findByText("report.docx");
  expect(within(recent).getByText("2 minutes ago")).toBeTruthy();
  expect(within(recent).getByText("yesterday")).toBeTruthy();
});

test("reorder_persists", async () => {
  await shown(["/home/t/a.txt", "/home/t/b.txt", "/home/t/c.txt"]);
  const rows = [...document.querySelectorAll<HTMLElement>("[data-pin]")];
  // jsdom lays nothing out: each row is given 20 pixels of height, one under the other.
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({
        top: i * 20,
        height: 20,
        bottom: i * 20 + 20,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;
  });
  const a = within(rows[0]!).getByRole("button");
  fireEvent.pointerDown(a, { button: 0, clientX: 5, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 5, clientY: 55, buttons: 1 });
  expect(rows[2]!.className).toContain("kern-insert-after");
  fireEvent.pointerUp(window, { clientX: 5, clientY: 55 });
  const looked = ipc.mimeOf.mock.calls.length;
  fireEvent.click(a);
  expect(ipc.pinsReorder).toHaveBeenCalledExactlyOnceWith([
    p("/home/t/b.txt"),
    p("/home/t/c.txt"),
    p("/home/t/a.txt"),
  ]);
  // The click that ended the drag opened nothing: opening asks mime_of first, at once.
  expect(ipc.mimeOf.mock.calls.length).toBe(looked);
  // The backend's event is what the list shows.
  act(() => handlers["kern://pins-changed"]!({ entries: ipc.pinsReorder.mock.calls[0]![0] }));
  expect(pinRows()).toEqual(["b.txt", "c.txt", "a.txt"]);
});

test("a_press_that_does_not_travel_opens_and_does_not_reorder", async () => {
  await shown(["/home/t/a.txt", "/home/t/b.txt"]);
  const a = within(screen.getByTestId("pinned")).getByText("a.txt").closest("button")!;
  fireEvent.pointerDown(a, { button: 0, clientX: 5, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 7, clientY: 13, buttons: 1 });
  fireEvent.pointerUp(window, { clientX: 7, clientY: 13 });
  fireEvent.click(a);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  expect(ipc.pinsReorder).not.toHaveBeenCalled();
});

test("folder_click_navigates_current_tab", async () => {
  useTabs.getState().openFolder(p("/home/t"), true);
  const tab = useTabs.getState().tabs[0]!;
  await shown(["/home/t/Invoices"]);
  fireEvent.click(within(screen.getByTestId("pinned")).getByText("Invoices"));
  await waitFor(() => {
    const now = useTabs.getState().tabs;
    expect(now).toHaveLength(1);
    expect(now[0]!.kind === "folder" && now[0]!.path).toEqual(p("/home/t/Invoices"));
  });
  expect(useTabs.getState().activeId).toBe(tab.id);
  expect(ipc.openPaths).not.toHaveBeenCalled();
});

test("file_click_opens_from_inside", async () => {
  const { recent } = await shown([], [["/home/t/notes.md", NOW]]);
  fireEvent.click(await within(recent).findByText("notes.md"));
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith(
      [p("/home/t/notes.md")],
      "inside",
      "default"
    )
  );
});

test("a_folder_open_as_an_editor_is_marked_and_reopens_as_an_editor", async () => {
  ipc.openEditor.mockResolvedValue("editor-2");
  ipc.prune.mockResolvedValue({
    ...report([]),
    recents: { entries: [{ path: p("/home/t/Work"), opened_ms: NOW, as_editor: true }] },
  });
  render(<PinnedRecentPanel />);
  const recent = screen.getByTestId("recent");
  const row = (await within(recent).findByText("Work")).closest("button")!;
  expect(within(row).getByText(/^Editor · /)).toBeInTheDocument();
  fireEvent.click(row, { detail: 1 });
  expect(ipc.openEditor).not.toHaveBeenCalled();
  fireEvent.doubleClick(row);
  await waitFor(() => expect(ipc.openEditor).toHaveBeenCalledExactlyOnceWith(p("/home/t/Work")));
  // Opened as an editor, it is never shown in a folder tab.
  expect(ipc.openPaths).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs).toHaveLength(0);
});

test("with_single_click_on_one_click_opens_a_recent_entry_once", async () => {
  useViewSettings.setState({ singleClick: true });
  ipc.openEditor.mockResolvedValue("editor-2");
  ipc.prune.mockResolvedValue({
    ...report([]),
    recents: { entries: [{ path: p("/home/t/Work"), opened_ms: NOW, as_editor: true }] },
  });
  render(<PinnedRecentPanel />);
  const recent = screen.getByTestId("recent");
  const row = (await within(recent).findByText("Work")).closest("button")!;
  fireEvent.click(row, { detail: 1 });
  await waitFor(() => expect(ipc.openEditor).toHaveBeenCalledExactlyOnceWith(p("/home/t/Work")));
  fireEvent.click(row, { detail: 2 });
  fireEvent.doubleClick(row);
  await act(async () => {});
  expect(ipc.openEditor).toHaveBeenCalledTimes(1);
});

test("a_folder_pinned_as_an_editor_is_marked_and_opens_as_an_editor", async () => {
  ipc.openEditor.mockResolvedValue("editor-2");
  ipc.prune.mockResolvedValue({
    ...report(["/home/t/Work"]),
    pins: { entries: [p("/home/t/Work")], editors: [p("/home/t/Work")] },
  });
  render(<PinnedRecentPanel />);
  const pinned = screen.getByTestId("pinned");
  const row = (await within(pinned).findByText("Work")).closest("button")!;
  await waitFor(() => expect(within(row).getByText(/^Editor · /)).toBeInTheDocument());
  fireEvent.doubleClick(row);
  await waitFor(() => expect(ipc.openEditor).toHaveBeenCalledExactlyOnceWith(p("/home/t/Work")));
  expect(useTabs.getState().tabs).toHaveLength(0);
});

test("an_editor_pin_offers_its_folder_tab_and_a_folder_pin_the_editor", async () => {
  ipc.prune.mockResolvedValue({
    ...report(["/home/t/Work", "/home/t/Docs"]),
    pins: { entries: [p("/home/t/Work"), p("/home/t/Docs")], editors: [p("/home/t/Work")] },
  });
  render(<PinnedRecentPanel />);
  const pinned = screen.getByTestId("pinned");
  const work = (await within(pinned).findByText("Work")).closest("button")!;
  await waitFor(() => expect(within(work).getByText(/^Editor · /)).toBeInTheDocument());
  const openSection = (menu: HTMLElement) =>
    within(within(menu).getAllByRole("group")[0]!)
      .getAllByRole("menuitem")
      .map((m) => m.textContent?.trim());

  fireEvent.keyDown(work, { key: "ContextMenu" });
  const menu = await screen.findByRole("menu");
  expect(openSection(menu)).toEqual(["Open", "Open file location", "Open in file manager"]);
  fireEvent.click(within(menu).getByRole("menuitem", { name: /^Open in file manager/ }));
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([p("/home/t/Work")], "inside", "default")
  );
  expect(ipc.openEditor).not.toHaveBeenCalled();

  const docs = within(pinned).getByText("Docs").closest("button")!;
  fireEvent.keyDown(docs, { key: "ContextMenu" });
  const second = await screen.findByRole("menu");
  expect(openSection(second)).toEqual(["Open", "Open file location", "Open as editor"]);
  expect(within(second).getByRole("menuitem", { name: /^Open as editor$/ })).toBeEnabled();
});

test("vanished_pin_pruned_on_focus", async () => {
  await shown(["/home/t/a.txt", "/home/t/gone.txt"]);
  expect(ipc.prune).toHaveBeenCalledTimes(1);
  ipc.prune.mockResolvedValue(report(["/home/t/a.txt"], [], ["/home/t/gone.txt"]));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(pinRows()).toEqual(["a.txt"]));
  expect(ipc.prune).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Removed from Pinned, since it no longer exists: gone.txt")).toBeTruthy();
});

test("a_failed_open_is_shown_and_prunes", async () => {
  const { recent } = await shown([], [["/home/t/gone.md", NOW]]);
  ipc.openPaths.mockResolvedValue([
    {
      path: p("/home/t/gone.md"),
      action: "failed",
      location: null,
      error: { kind: "NotFound", message: "no such file", path: null, details: null },
    },
  ]);
  ipc.prune.mockResolvedValue(report([]));
  fireEvent.click(await within(recent).findByText("gone.md"));
  expect(
    await screen.findByText("gone.md could not be opened: NotFound: no such file")
  ).toBeTruthy();
  await waitFor(() => expect(ipc.prune).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(recent).queryByText("gone.md")).toBeNull());
});

test("unpin_from_the_entry_menu", async () => {
  ipc.unpin.mockResolvedValue({ entries: [] } satisfies Pins);
  await shown(["/home/t/a.txt"]);
  const a = within(screen.getByTestId("pinned")).getByText("a.txt").closest("button")!;
  fireEvent.keyDown(a, { key: "ContextMenu" });
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: /^Move up/ })).toHaveProperty("disabled", true);
  fireEvent.click(within(menu).getByRole("menuitem", { name: /^Unpin/ }));
  await waitFor(() => expect(ipc.unpin).toHaveBeenCalledExactlyOnceWith(p("/home/t/a.txt")));
});

test("an_unreadable_pins_file_is_reported", async () => {
  ipc.storeErrorsTake.mockResolvedValue([
    {
      file: "pins.json",
      moved_to: p("/home/t/.local/state/kern/pins.json.corrupt"),
      field: null,
      reason: "expected value",
    },
    { file: "settings.json", moved_to: null, field: "accent", reason: "unknown variant" },
  ]);
  await shown([]);
  expect(
    await screen.findByText(
      "pins.json could not be read: expected value. It was kept as pins.json.corrupt and Kern started a fresh one."
    )
  ).toBeTruthy();
  expect(screen.queryByText(/settings\.json/)).toBeNull();
  // Every report stays where the settings view reads them, settings.json's included.
  expect(useStoreErrors.getState().reports).toHaveLength(2);
});

test("a_failed_first_read_offers_retry", async () => {
  ipc.prune.mockRejectedValueOnce({ kind: "Io", message: "denied", path: null, details: null });
  render(<PinnedRecentPanel />);
  expect(await screen.findByText("Pinned and Recent could not be read: Io: denied")).toBeTruthy();
  ipc.prune.mockResolvedValue(report(["/home/t/a.txt"]));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(pinRows()).toEqual(["a.txt"]));
  expect(screen.queryByText(/could not be read/)).toBeNull();
});

test("an_event_newer_than_the_prune_answer_wins", async () => {
  let answer!: (r: PruneReport) => void;
  ipc.prune.mockReturnValue(new Promise<PruneReport>((r) => (answer = r)));
  render(<PinnedRecentPanel />);
  await waitFor(() => expect(handlers["kern://pins-changed"]).toBeDefined());
  act(() => handlers["kern://pins-changed"]!({ entries: [p("/home/t/new.txt")] } satisfies Pins));
  act(() => handlers["kern://recents-changed"]!({ entries: [] } satisfies Recents));
  await act(async () => answer(report(["/home/t/old.txt"])));
  expect(pinRows()).toEqual(["new.txt"]);
});

/** Renders the panel with prune held open; resolves the answer when called. */
async function heldPrune() {
  let answer!: (r: PruneReport) => void;
  ipc.prune.mockReturnValueOnce(new Promise<PruneReport>((r) => (answer = r)));
  render(<PinnedRecentPanel />);
  await waitFor(() => expect(ipc.prune).toHaveBeenCalled());
  return (r: PruneReport) => act(async () => answer(r));
}

test("a_pins_event_before_the_prune_answer_keeps_the_answers_recents", async () => {
  const answer = await heldPrune();
  act(() => handlers["kern://pins-changed"]!({ entries: [p("/home/t/new.txt")] } satisfies Pins));
  await answer(report(["/home/t/old.txt"], [["/home/t/r.md", NOW]]));
  expect(pinRows()).toEqual(["new.txt"]);
  expect(within(screen.getByTestId("recent")).getByText("r.md")).toBeTruthy();
});

test("a_recents_event_before_the_prune_answer_is_kept", async () => {
  const answer = await heldPrune();
  act(() =>
    handlers["kern://recents-changed"]!({
      entries: [{ path: p("/home/t/new.md"), opened_ms: NOW }],
    } satisfies Recents)
  );
  await answer(report(["/home/t/a.txt"], [["/home/t/old.md", NOW]]));
  const recent = screen.getByTestId("recent");
  expect(within(recent).getByText("new.md")).toBeTruthy();
  expect(within(recent).queryByText("old.md")).toBeNull();
  expect(pinRows()).toEqual(["a.txt"]);
});

test("a_pin_shows_from_the_answer_when_events_are_refused", async () => {
  ipc.on.mockImplementation((name: string) =>
    name === "kern://store-error"
      ? Promise.resolve(() => undefined)
      : Promise.reject({ kind: "Ipc", message: "listen refused", path: null, details: null })
  );
  ipc.prune.mockResolvedValue(report([]));
  ipc.pin.mockResolvedValue({ entries: [p("/home/t/a.txt")] } satisfies Pins);
  render(<PinnedRecentPanel />);
  expect(
    await screen.findByText(
      "Pinned and Recent will not follow changes made elsewhere: Ipc: listen refused"
    )
  ).toBeTruthy();
  await act(() => usePinnedRecent.getState().pinPaths([p("/home/t/a.txt")]));
  expect(pinRows()).toEqual(["a.txt"]);
});

test("a_failed_open_during_a_prune_prunes_again_after_it", async () => {
  const { recent } = await shown([], [["/home/t/gone.md", NOW]]);
  let focusAnswer!: (r: PruneReport) => void;
  ipc.prune.mockReturnValueOnce(new Promise<PruneReport>((r) => (focusAnswer = r)));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  ipc.openPaths.mockResolvedValue([
    {
      path: p("/home/t/gone.md"),
      action: "failed",
      location: null,
      error: { kind: "NotFound", message: "no such file", path: null, details: null },
    },
  ]);
  fireEvent.click(within(recent).getByText("gone.md"));
  await screen.findByText(/gone\.md could not be opened/);
  expect(ipc.prune).toHaveBeenCalledTimes(2);
  ipc.prune.mockResolvedValue(report([]));
  await act(async () => focusAnswer(report([], [["/home/t/gone.md", NOW]])));
  await waitFor(() => expect(ipc.prune).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(within(recent).queryByText("gone.md")).toBeNull());
});

test("a_drag_with_no_button_held_ends_without_moving", async () => {
  await shown(["/home/t/a.txt", "/home/t/b.txt"]);
  const rows = [...document.querySelectorAll<HTMLElement>("[data-pin]")];
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({
        top: i * 20,
        height: 20,
        bottom: i * 20 + 20,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;
  });
  fireEvent.pointerDown(within(rows[0]!).getByRole("button"), {
    button: 0,
    clientX: 5,
    clientY: 10,
  });
  fireEvent.pointerMove(window, { clientX: 5, clientY: 35, buttons: 1 });
  expect(rows[0]!.className).toContain("kern-entry-dragged");
  // The release happened outside the window; the next move has no button held.
  fireEvent.pointerMove(window, { clientX: 5, clientY: 35, buttons: 0 });
  expect(rows[0]!.className).not.toContain("kern-entry-dragged");
  fireEvent.pointerUp(window, { clientX: 5, clientY: 35 });
  expect(ipc.pinsReorder).not.toHaveBeenCalled();
});

test("a_kind_that_could_not_be_looked_up_is_said_on_the_row", async () => {
  ipc.mimeOf.mockRejectedValue({ kind: "Io", message: "stale handle", path: null, details: null });
  const { pinned } = await shown(["/home/t/a.txt"]);
  const row = within(pinned).getByText("a.txt").closest("button")!;
  await waitFor(() =>
    expect(row.title).toBe("/home/t/a.txt (its type could not be read: Io: stale handle)")
  );
});

test("the_same_notice_is_shown_once", async () => {
  await shown(["/home/t/a.txt"]);
  ipc.prune.mockRejectedValue({ kind: "Io", message: "denied", path: null, details: null });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
  }
  await waitFor(() => expect(ipc.prune).toHaveBeenCalledTimes(3));
  expect(screen.getAllByText("Pinned and Recent could not be checked: Io: denied")).toHaveLength(1);
});

test("every_follower_shares_one_subscription_which_ends_with_the_last", async () => {
  const off = vi.fn();
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(off);
  });
  ipc.prune.mockResolvedValue(report(["/home/t/Work"]));
  ipc.pinsGet.mockResolvedValue({ entries: [p("/home/t/Work")] });
  const store = usePinnedRecent.getState();
  const window = await store.follow({ prune: false });
  const panel = await store.follow();
  // One listener per event (pins, recents, the store-error reports), not one set per follower.
  expect(ipc.on).toHaveBeenCalledTimes(3);
  window();
  window();
  expect(off).not.toHaveBeenCalled();
  act(() => handlers["kern://pins-changed"]!({ entries: [p("/home/t/Invoices")] }));
  expect(usePinnedRecent.getState().pins).toEqual([p("/home/t/Invoices")]);
  panel();
  expect(off).toHaveBeenCalledTimes(3);
  // A follower after the last left subscribes again.
  await store.follow({ prune: false });
  expect(ipc.on).toHaveBeenCalledTimes(6);
});

test("the_window_follow_reads_the_pins_and_does_not_prune", async () => {
  ipc.pinsGet.mockResolvedValue({ entries: [p("/home/t/Work")] });
  await usePinnedRecent.getState().follow({ prune: false });
  expect(ipc.prune).not.toHaveBeenCalled();
  expect(usePinnedRecent.getState().pins).toEqual([p("/home/t/Work")]);

  // The panel shown later prunes.
  ipc.prune.mockResolvedValue(report(["/home/t/Work"]));
  await usePinnedRecent.getState().follow();
  expect(ipc.prune).toHaveBeenCalledTimes(1);
});

test("a_failed_read_of_the_pins_for_the_window_is_kept_for_the_strip", async () => {
  const err = { kind: "Io", message: "unreadable", path: null, details: null };
  ipc.pinsGet.mockRejectedValue(err);
  await usePinnedRecent.getState().follow({ prune: false });
  expect(usePinnedRecent.getState().pins).toBeNull();
  expect(usePinnedRecent.getState().loadError).toEqual(err);
});

test("a_follower_arriving_while_the_first_subscribes_shares_it", async () => {
  let resolveOn!: () => void;
  const gate = new Promise<void>((r) => (resolveOn = r));
  ipc.on.mockImplementation(async (name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    await gate;
    return () => undefined;
  });
  ipc.pinsGet.mockResolvedValue({ entries: [] });
  const store = usePinnedRecent.getState();
  const first = store.follow({ prune: false });
  const second = store.follow({ prune: false });
  resolveOn();
  await Promise.all([first, second]);
  // pins and recents, then the store-error reports: one set, not two.
  expect(ipc.on).toHaveBeenCalledTimes(3);
});

test("a_reset_while_subscribing_leaves_nothing_subscribed", async () => {
  let resolveOn!: () => void;
  const gate = new Promise<void>((r) => (resolveOn = r));
  const off = vi.fn();
  ipc.on.mockImplementation(async (name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    await gate;
    return off;
  });
  ipc.pinsGet.mockResolvedValue({ entries: [p("/home/t/Work")] });
  const pending = usePinnedRecent.getState().follow({ prune: false });
  usePinnedRecent.getState().reset();
  resolveOn();
  const stop = await pending;
  // What the stale subscription placed is taken down, and it wrote nothing into the fresh state.
  expect(off).toHaveBeenCalled();
  expect(usePinnedRecent.getState().pins).toBeNull();
  stop();
  // The next follower subscribes afresh.
  await usePinnedRecent.getState().follow({ prune: false });
  expect(usePinnedRecent.getState().pins).toEqual([p("/home/t/Work")]);
});

test("the_same_notice_raised_again_stays_one_notice_and_flashes", async () => {
  await shown([]);
  const notices = () => document.querySelectorAll(".kern-side-notices .kern-places-error");
  const flashes = () => document.querySelectorAll(".kern-side-notices .kern-repeat-flash");
  act(() => usePinnedRecent.getState().notify("Pinned and Recent could not be checked: no way"));
  expect(notices()).toHaveLength(1);
  expect(flashes()).toHaveLength(0);
  act(() => usePinnedRecent.getState().notify("Pinned and Recent could not be checked: no way"));
  expect(notices()).toHaveLength(1);
  expect(flashes()).toHaveLength(1);
  const first = flashes()[0];
  act(() => usePinnedRecent.getState().notify("Pinned and Recent could not be checked: no way"));
  expect(notices()).toHaveLength(1);
  expect(flashes()[0]).not.toBe(first);
  // Other words are a second notice, not a repeat of the first.
  act(() => usePinnedRecent.getState().notify("Something else"));
  expect(notices()).toHaveLength(2);
});
