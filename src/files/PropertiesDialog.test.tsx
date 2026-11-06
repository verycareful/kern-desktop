// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpDoneEvent, WireProperties, WirePath } from "../ipc";
import { dir, entry } from "./test-entries";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  entryOf: vi.fn(),
  properties: vi.fn(),
  cancelOp: vi.fn(),
  appDefault: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { PropertiesDialog } from "./PropertiesDialog";

const p = (v: string): WirePath => ({ k: "Utf8", v });
let handlers: Record<string, (payload: unknown) => void>;
const onClose = vi.fn();

function done(props: Partial<WireProperties>, op = 7): OpDoneEvent {
  return {
    op,
    report: null,
    scan: null,
    error: null,
    properties: { files: 1, dirs: 0, bytes: 0, unreadable: [], cancelled: false, ...props },
  };
}

beforeEach(() => {
  handlers = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.properties.mockResolvedValue(7);
  ipc.cancelOp.mockResolvedValue(undefined);
  ipc.appDefault.mockResolvedValue({
    app: {
      id: "gedit.desktop",
      name: "Text Editor",
      icon: null,
      terminal: false,
      no_display: false,
      mime_types: [],
    },
    problems: [],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rowOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!;

test("one_file_shows_its_type_size_time_permissions_and_application", async () => {
  ipc.entryOf.mockResolvedValue(
    entry(
      "notes.md",
      { mime: "text/markdown", mode: 0o640, len: 2048, modified_ms: Date.UTC(2026, 9, 17, 9, 30) },
      "/home/t"
    )
  );
  render(<PropertiesDialog paths={[p("/home/t/notes.md")]} onClose={onClose} />);
  await screen.findByText("notes.md", { selector: "dd" });
  await waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  await waitFor(() => expect(ipc.properties).toHaveBeenCalledWith([p("/home/t/notes.md")]));
  act(() => handlers["kernkraft://op-done"]!(done({ bytes: 2048 })));
  expect(rowOf("Type")).toHaveTextContent("File (text/markdown)");
  expect(rowOf("Location")).toHaveTextContent("/home/t");
  expect(rowOf("Permissions")).toHaveTextContent("rw-r----- (0640)");
  expect(rowOf("Modified")).toHaveTextContent("2026");
  await waitFor(() => expect(rowOf("Size")).toHaveTextContent("2,048 bytes"));
  await waitFor(() => expect(rowOf("Opens with")).toHaveTextContent("Text Editor"));
  expect(screen.queryByText("Contains")).toBeNull();
});

test("the_root_folder_is_named_slash_and_not_left_blank", async () => {
  // The listing gives the root no name of its own.
  ipc.entryOf.mockResolvedValue(dir("", { mode: 0o755 }));
  render(<PropertiesDialog paths={[p("/")]} onClose={onClose} />);
  await waitFor(() => expect(rowOf("Name")).toHaveTextContent("/"));
  expect(rowOf("Name").textContent).toBe("/");
});

test("a_folder_counts_what_it_holds_and_says_what_it_could_not_read", async () => {
  ipc.entryOf.mockResolvedValue(dir("Work", { mode: 0o755 }));
  render(<PropertiesDialog paths={[p("/d/Work")]} onClose={onClose} />);
  await screen.findByText("Work", { selector: "dd" });
  await waitFor(() => expect(handlers["kernkraft://op-progress"]).toBeDefined());
  await waitFor(() => expect(ipc.properties).toHaveBeenCalled());
  act(() =>
    handlers["kernkraft://op-progress"]!({ op: 7, done: 40, total: 0, unit: "entries", stage: "" })
  );
  expect(rowOf("Size")).toHaveTextContent("Counting… 40 items");
  act(() =>
    handlers["kernkraft://op-done"]!(
      done({ files: 12, dirs: 3, bytes: 1000, unreadable: [p("/d/Work/locked")] })
    )
  );
  await waitFor(() => expect(rowOf("Size")).toHaveTextContent("at least"));
  // The walk counts the folder itself among the three.
  expect(rowOf("Contains")).toHaveTextContent("12 files, 2 folders");
  expect(rowOf("Not read")).toHaveTextContent("/d/Work/locked");
  expect(rowOf("Permissions")).toHaveTextContent("rwxr-xr-x (0755)");
  // A folder has no application of its own.
  expect(screen.queryByText("Opens with")).toBeNull();
  expect(ipc.appDefault).not.toHaveBeenCalled();
});

test("closing_cancels_a_size_still_being_counted", async () => {
  ipc.entryOf.mockResolvedValue(dir("Big"));
  const { unmount } = render(<PropertiesDialog paths={[p("/d/Big")]} onClose={onClose} />);
  await waitFor(() => expect(ipc.properties).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledExactlyOnceWith(7));
});

test("several_items_are_counted_together", async () => {
  render(<PropertiesDialog paths={[p("/d/a"), p("/d/b")]} onClose={onClose} />);
  expect(screen.getByRole("heading")).toHaveTextContent("Properties of 2 items");
  await waitFor(() => expect(ipc.properties).toHaveBeenCalledWith([p("/d/a"), p("/d/b")]));
  await waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  act(() => handlers["kernkraft://op-done"]!(done({ files: 2, bytes: 10 })));
  expect(rowOf("Location")).toHaveTextContent("/d");
  await waitFor(() => expect(rowOf("Size")).toHaveTextContent("10 bytes"));
  expect(rowOf("In all")).toHaveTextContent(
    "2 files, 0 folders, counting the selected items themselves"
  );
  expect(ipc.entryOf).not.toHaveBeenCalled();
});

test("an_item_that_cannot_be_read_says_so", async () => {
  ipc.entryOf.mockRejectedValue({
    kind: "NotFound",
    message: "no such file",
    path: null,
    details: null,
  });
  render(<PropertiesDialog paths={[p("/d/gone")]} onClose={onClose} />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("gone could not be read: NotFound: no such file");
  expect(
    within(screen.getByTestId("properties-dialog")).getByRole("button", { name: "Close" })
  ).toBeTruthy();
});

test("a_link_has_no_permissions_of_its_own_and_holds_nothing", async () => {
  ipc.entryOf.mockResolvedValue(
    entry("to-work", { kind: "symlink", target_is_dir: true, mode: 0o777, mime: "inode/directory" })
  );
  render(<PropertiesDialog paths={[p("/d/to-work")]} onClose={onClose} />);
  await screen.findByText("to-work", { selector: "dd" });
  await waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  await waitFor(() => expect(ipc.properties).toHaveBeenCalled());
  act(() => handlers["kernkraft://op-done"]!(done({ files: 1, bytes: 7 })));
  expect(rowOf("Type")).toHaveTextContent("Link to a folder");
  expect(rowOf("Permissions")).toHaveTextContent("none of its own");
  expect(rowOf("Permissions")).not.toHaveTextContent("0777");
  await waitFor(() => expect(rowOf("Size")).toHaveTextContent("the link itself"));
  expect(screen.queryByText("Contains")).toBeNull();
});
