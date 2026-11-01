// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Pins, PruneReport, Recents, WirePath } from "../ipc";
import { useTabs } from "../store/tabs";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  prune: vi.fn(),
  storeErrorsTake: vi.fn(),
  mimeOf: vi.fn(),
  openPaths: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  pinsReorder: vi.fn(),
  userDirs: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { PinnedRecentPanel } from "./PinnedRecentPanel";
import { usePinnedRecent } from "./pinned-recent-store";
import { useUserDirs } from "./user-dirs-store";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FOLDERS = new Set(["/home/t/Invoices", "/home/t/Work"]);
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
  useUserDirs.getState().reset();
  useTabs.setState({ tabs: [], activeId: null });
});
afterEach(() => {
  cleanup();
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
  fireEvent.pointerMove(window, { clientX: 5, clientY: 55 });
  expect(rows[2]!.className).toContain("kern-insert-after");
  fireEvent.pointerUp(window, { clientX: 5, clientY: 55 });
  fireEvent.click(a);
  expect(ipc.pinsReorder).toHaveBeenCalledExactlyOnceWith([
    p("/home/t/b.txt"),
    p("/home/t/c.txt"),
    p("/home/t/a.txt"),
  ]);
  // The click that ended the drag opened nothing.
  await act(async () => {
    await Promise.resolve();
  });
  expect(ipc.openPaths).not.toHaveBeenCalled();
  // The backend's event is what the list shows.
  act(() => handlers["kern://pins-changed"]!({ entries: ipc.pinsReorder.mock.calls[0]![0] }));
  expect(pinRows()).toEqual(["b.txt", "c.txt", "a.txt"]);
});

test("a_press_that_does_not_travel_opens_and_does_not_reorder", async () => {
  await shown(["/home/t/a.txt", "/home/t/b.txt"]);
  const a = within(screen.getByTestId("pinned")).getByText("a.txt").closest("button")!;
  fireEvent.pointerDown(a, { button: 0, clientX: 5, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 7, clientY: 13 });
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
  expect(usePinnedRecent.getState().corrupt).toHaveLength(2);
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
