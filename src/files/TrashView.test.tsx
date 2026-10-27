// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpDoneEvent, WireReport, WireTrashedItem, WirePath } from "../ipc";
import { useShortcuts } from "../keys/useShortcuts";
import { useTabs, type TrashTab } from "../store/tabs";
import { stubLayout } from "./test-layout";

const ipc = vi.hoisted(() => ({
  trashList: vi.fn(),
  trashRestore: vi.fn(),
  trashPurge: vi.fn(),
  startOp: vi.fn(),
  cancelOp: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { TrashView } from "./TrashView";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const item = (name: string, over: Partial<WireTrashedItem> = {}): WireTrashedItem => ({
  id: `id-${name}`,
  name,
  original: p(`/home/t/docs/${name}`),
  deleted: "2026-10-20T14:05:09",
  trash_dir: p("/home/t/.local/share/Trash"),
  is_dir: false,
  ...over,
});
const report = (over: Partial<WireReport> = {}): WireReport => ({
  done: [],
  skipped: [],
  failed: [],
  warnings: [],
  cancelled: false,
  not_reached: [],
  ...over,
});

let handlers: Record<string, (payload: unknown) => void>;
let restoreLayout: () => void;
let tab: TrashTab;

function Host() {
  useShortcuts();
  return <TrashView tab={tab} />;
}

beforeEach(() => {
  restoreLayout = stubLayout();
  handlers = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  useTabs.getState().openTrash();
  tab = useTabs.getState().tabs[0] as TrashTab;
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  vi.clearAllMocks();
});

const rows = () => screen.queryAllByTestId("trash-row");
async function shown(items: WireTrashedItem[], unreadable: unknown[] = []) {
  ipc.trashList.mockResolvedValue({ items, unreadable });
  render(<Host />);
  await waitFor(() => expect(rows()).toHaveLength(items.length));
}

test("the_trash_lists_name_original_path_and_deletion_time", async () => {
  await shown([item("a.txt"), item("b.txt", { original: p("/mnt/usb/old/b.txt") })]);
  const first = rows()[0]!;
  expect(first).toHaveTextContent("a.txt");
  expect(first).toHaveTextContent("/home/t/docs/a.txt");
  // The raw DeletionDate (YYYY-MM-DDThh:mm:ss, local time) is shown as a date and a time.
  expect(first).toHaveTextContent(/2026/);
  expect(first).toHaveTextContent("14:05");
  expect(rows()[1]).toHaveTextContent("/mnt/usb/old/b.txt");
  for (const h of ["Name", "Original location", "Deleted"]) {
    expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
  }
});

test("an_empty_trash_says_so_and_disables_emptying", async () => {
  await shown([]);
  expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Empty Trash" })).toBeDisabled();
});

test("a_trash_that_cannot_be_listed_says_why_and_retries", async () => {
  ipc.trashList.mockRejectedValueOnce({
    kind: "Io",
    message: "cannot read the trash",
    path: null,
    details: null,
  });
  render(<Host />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("cannot read the trash");
  ipc.trashList.mockResolvedValue({ items: [item("a.txt")], unreadable: [] });
  fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(rows()).toHaveLength(1));
});

test("items_the_trash_could_not_read_are_listed_with_the_reason", async () => {
  await shown(
    [item("a.txt")],
    [
      {
        path: p("/home/t/.local/share/Trash/info/bad.trashinfo"),
        error: { kind: "Malformed", message: "no Path key", path: null, details: null },
      },
    ]
  );
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("bad.trashinfo");
  expect(alert).toHaveTextContent("no Path key");
});

test("restore_into_removed_folder_reports", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  // The folder the item was deleted from is gone and cannot be recreated.
  ipc.trashRestore.mockRejectedValue({
    kind: "Io",
    message: "cannot create /home/t/docs: permission denied",
    path: p("/home/t/docs"),
    details: null,
  });
  fireEvent.click(rows()[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const panel = await screen.findByTestId("report-panel");
  expect(panel).toHaveTextContent("Restore from Trash");
  expect(panel).toHaveTextContent("cannot create /home/t/docs: permission denied");
  expect(ipc.trashRestore).toHaveBeenCalledWith([item("a.txt")]);
  // Nothing was restored, so the item is still listed.
  expect(rows()).toHaveLength(2);
});

test("a_restore_report_lists_every_failed_item_with_its_reason", async () => {
  await shown([item("a.txt"), item("b.txt"), item("c.txt")]);
  ipc.trashRestore.mockResolvedValue(
    report({
      done: [{ source: p("/t/files/a.txt"), dest: p("/home/t/docs/a.txt") }],
      failed: [
        {
          path: p("/home/t/docs/b.txt"),
          error: { kind: "Exists", message: "b.txt is already there", path: null, details: null },
        },
        {
          path: p("/home/t/docs/c.txt"),
          error: {
            kind: "NotInTrash",
            message: "c.txt is not in the trash",
            path: null,
            details: null,
          },
        },
      ],
    })
  );
  ipc.trashList.mockResolvedValue({ items: [item("b.txt"), item("c.txt")], unreadable: [] });
  fireEvent.click(rows()[0]!);
  fireEvent.keyDown(rows()[0]!, { key: "a", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const panel = await screen.findByTestId("report-panel");
  const lines = within(panel).getAllByTestId("report-item");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent("/home/t/docs/b.txt");
  expect(lines[0]).toHaveTextContent("b.txt is already there");
  expect(lines[1]).toHaveTextContent("c.txt is not in the trash");
  // The list is read again: what was restored is gone from it.
  await waitFor(() => expect(rows()).toHaveLength(2));
});

test("delete_permanently_confirms_and_says_it_cannot_be_undone", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  fireEvent.click(rows()[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  const ask = await screen.findByRole("alertdialog");
  expect(ask).toHaveTextContent(/cannot be undone/i);
  expect(ask).toHaveTextContent("b.txt");
  expect(ipc.trashPurge).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: /cancel/i }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.trashPurge).not.toHaveBeenCalled();
  ipc.trashPurge.mockResolvedValue(
    report({ done: [{ source: p("/home/t/docs/b.txt"), dest: null }] })
  );
  ipc.trashList.mockResolvedValue({ items: [item("a.txt")], unreadable: [] });
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: /delete 1 item/i })
  );
  await waitFor(() => expect(ipc.trashPurge).toHaveBeenCalledWith([item("b.txt")]));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(screen.queryByTestId("report-panel")).toBeNull();
});

test("empty_trash_confirms_then_runs_op", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  let announce!: (id: number) => void;
  ipc.startOp.mockImplementation(() => new Promise<number>((r) => (announce = r)));
  fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
  const ask = await screen.findByRole("alertdialog");
  expect(ask).toHaveTextContent(/cannot be undone/i);
  // Nothing runs before the answer.
  expect(ipc.startOp).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: /empty the trash/i }));
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("empty_trash", []));
  await act(async () => announce(4));
  // Progress of the op is shown, and the work can be cancelled.
  await act(async () =>
    handlers["kernkraft://op-progress"]!({ op: 4, done: 1, total: 2, unit: "items", stage: "" })
  );
  const progress = await screen.findByRole("progressbar");
  expect(progress).toHaveAttribute("aria-valuenow", "1");
  expect(progress).toHaveAttribute("aria-valuemax", "2");
  expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  // The view stays usable meanwhile: other rows can still be selected.
  fireEvent.click(rows()[1]!);
  // The end of the op: the list is read again and is empty.
  ipc.trashList.mockResolvedValue({ items: [], unreadable: [] });
  const done: OpDoneEvent = {
    op: 4,
    report: report({
      done: [
        { source: p("/home/t/docs/a.txt"), dest: null },
        { source: p("/home/t/docs/b.txt"), dest: null },
      ],
    }),
    properties: null,
    scan: null,
    error: null,
  };
  await act(async () => handlers["kernkraft://op-done"]!(done));
  await waitFor(() => expect(rows()).toHaveLength(0));
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByTestId("report-panel")).toBeNull();
});

test("an_empty_trash_that_left_items_behind_reports_each_one", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  ipc.startOp.mockResolvedValue(6);
  fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: /empty the trash/i })
  );
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await act(async () => {});
  await act(async () =>
    handlers["kernkraft://op-done"]!({
      op: 6,
      report: report({
        done: [{ source: p("/home/t/docs/a.txt"), dest: null }],
        failed: [
          {
            path: p("/home/t/docs/b.txt"),
            error: { kind: "Io", message: "permission denied", path: null, details: null },
          },
        ],
      }),
      properties: null,
      scan: null,
      error: null,
    } satisfies OpDoneEvent)
  );
  const panel = await screen.findByTestId("report-panel");
  expect(panel).toHaveTextContent("Empty Trash");
  expect(panel).toHaveTextContent("/home/t/docs/b.txt");
  expect(panel).toHaveTextContent("permission denied");
});

test("an_empty_trash_that_could_not_start_shows_the_error", async () => {
  await shown([item("a.txt")]);
  ipc.startOp.mockRejectedValue({
    kind: "Busy",
    message: "an undo or another operation is running",
    path: null,
    details: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: /empty the trash/i })
  );
  const panel = await screen.findByTestId("report-panel");
  expect(panel).toHaveTextContent("an undo or another operation is running");
});

test("a_cancelled_empty_trash_says_how_far_it_got", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  ipc.startOp.mockResolvedValue(8);
  ipc.cancelOp.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: /empty the trash/i })
  );
  await screen.findByRole("progressbar");
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(8));
  await act(async () =>
    handlers["kernkraft://op-done"]!({
      op: 8,
      report: report({
        done: [{ source: p("/home/t/docs/a.txt"), dest: null }],
        cancelled: true,
        not_reached: [p("/home/t/docs/b.txt")],
      }),
      properties: null,
      scan: null,
      error: null,
    } satisfies OpDoneEvent)
  );
  const panel = await screen.findByTestId("report-panel");
  expect(panel).toHaveTextContent(/cancelled/i);
  expect(panel).toHaveTextContent(/1 not reached/);
});

test("a_name_that_is_not_utf8_stays_a_wire_path_end_to_end", async () => {
  const raw = p("/home/t/docs/x");
  const odd: WireTrashedItem = item("a\uFFFD.txt", {
    original: { k: "Bytes", v: btoa("/home/t/docs/caf\xe9.txt") },
  });
  await shown([odd, item("b.txt")]);
  // Shown with the replacement character...
  expect(rows()[0]).toHaveTextContent("/home/t/docs/caf\uFFFD.txt");
  // ...but what goes back to the backend is the item as listed, untouched.
  ipc.trashRestore.mockResolvedValue(report({ done: [{ source: raw, dest: raw }] }));
  fireEvent.click(rows()[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(ipc.trashRestore).toHaveBeenCalledTimes(1));
  expect(ipc.trashRestore.mock.calls[0]![0]).toEqual([odd]);
  expect(ipc.trashRestore.mock.calls[0]![0][0].original).toEqual({
    k: "Bytes",
    v: btoa("/home/t/docs/caf\xe9.txt"),
  });
});

test("the_keyboard_selects_and_the_menu_carries_the_same_actions", async () => {
  await shown([item("a.txt"), item("b.txt")]);
  fireEvent.click(rows()[0]!);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(rows()[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  expect(rows().every((r) => r.getAttribute("aria-selected") === "true")).toBe(true);
  fireEvent.contextMenu(rows()[0]!);
  const menu = await screen.findByRole("menu");
  for (const name of [/^restore/i, /delete permanently/i, /empty trash/i]) {
    expect(within(menu).getByRole("menuitem", { name })).toBeEnabled();
  }
});
