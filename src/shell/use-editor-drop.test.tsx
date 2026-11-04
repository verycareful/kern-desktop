// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DropPayload, WirePath, WireSame } from "../ipc";
import { DROP_DOCS_ATTR, DROP_TARGET_ATTR, dropTargetValue } from "../ops/dnd";
import { OpsHost } from "../ops/OpsHost";
import { useOps } from "../ops/useOps";
import { useEditorDrop } from "./use-editor-drop";

// A drop from another program on an editor window: onto a folder of the tree it is
// copied or moved as in the main window, onto the documents a text file opens as a tab of this
// window, and onto anything else nothing happens (the hover says why).

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  startOp: vi.fn(),
  dropStartOp: vi.fn(),
  answerConflict: vi.fn(),
  cancelOp: vi.fn(),
  undoState: vi.fn(),
  sameFilesystem: vi.fn(),
  mimeOf: vi.fn(),
  openPaths: vi.fn(),
  dndTarget: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

const p = (v: string): WirePath => ({ k: "Utf8", v });
let subscribed: Record<string, ((payload: unknown) => void)[]>;

function Window() {
  useEditorDrop();
  return (
    <>
      <aside>
        <div id="row" data-testid="row" {...{ [DROP_TARGET_ATTR]: dropTargetValue(p("/d/sub")) }}>
          sub
        </div>
      </aside>
      <main id="docs" data-testid="docs" {...{ [DROP_DOCS_ATTR]: "" }}>
        documents
      </main>
      <div id="bar" data-testid="bar">
        status
      </div>
      <OpsHost editor />
    </>
  );
}

/** `elementFromPoint` answers with the element the test names. */
function pointerOver(id: string) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => document.getElementById(id)),
  });
}

function dropOf(over: Partial<DropPayload> = {}): DropPayload {
  return {
    paths: [p("/x/f")],
    position: { x: 40, y: 40 },
    view: { width: window.innerWidth, height: window.innerHeight },
    offered: ["copy", "move", "link"],
    modifier: null,
    drag: 1,
    ...over,
  };
}

async function drop(over: Partial<DropPayload> = {}) {
  await waitFor(() => expect(subscribed["kern://drop"]?.length ?? 0).toBeGreaterThan(0));
  act(() => subscribed["kern://drop"]!.forEach((h) => h(dropOf(over))));
  await act(async () => {});
}

const same: WireSame = { state: "checked", same: true };
const different: WireSame = { state: "checked", same: false };

beforeEach(() => {
  subscribed = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    (subscribed[name] ??= []).push(h);
    return Promise.resolve(() => undefined);
  });
  ipc.dropStartOp.mockResolvedValue(1);
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.dndTarget.mockResolvedValue(undefined);
  ipc.sameFilesystem.mockImplementation((s: WirePath[]) => Promise.resolve(s.map(() => same)));
  ipc.mimeOf.mockImplementation((path: WirePath) =>
    Promise.resolve(
      path.v.endsWith(".txt")
        ? { mime: "text/plain", is_text: true }
        : { mime: "application/pdf", is_text: false }
    )
  );
  ipc.openPaths.mockImplementation((paths: WirePath[]) =>
    Promise.resolve(paths.map((x) => ({ path: x, action: "doc_tab", location: null, error: null })))
  );
  useOps.getState().reset();
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  for (const m of Object.values(ipc)) m.mockReset();
});

test("a_drop_on_a_folder_of_the_tree_moves_what_is_on_its_filesystem_and_copies_the_rest", async () => {
  render(<Window />);
  pointerOver("row");
  ipc.sameFilesystem.mockResolvedValue([different, same]);
  await drop({ paths: [p("/x/f"), p("/x/g")] });
  await waitFor(() => expect(ipc.dropStartOp).toHaveBeenCalledTimes(2));
  expect(ipc.sameFilesystem).toHaveBeenCalledExactlyOnceWith([p("/x/f"), p("/x/g")], p("/d/sub"));
  expect(ipc.dropStartOp).toHaveBeenCalledWith("move", [p("/x/g")], p("/d/sub"));
  expect(ipc.dropStartOp).toHaveBeenCalledWith("copy", [p("/x/f")], p("/d/sub"));
  // The editor window's capability does not grant the general command, which can delete.
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(ipc.openPaths).not.toHaveBeenCalled();
});

test("what_the_other_program_offers_and_the_key_held_decide_before_any_disk_is_looked_at", async () => {
  render(<Window />);
  pointerOver("row");
  await drop({ offered: ["copy"] });
  await waitFor(() =>
    expect(ipc.dropStartOp).toHaveBeenCalledWith("copy", [p("/x/f")], p("/d/sub"))
  );
  ipc.dropStartOp.mockClear();
  await drop({ modifier: "move" });
  await waitFor(() =>
    expect(ipc.dropStartOp).toHaveBeenCalledWith("move", [p("/x/f")], p("/d/sub"))
  );
  expect(ipc.sameFilesystem).not.toHaveBeenCalled();
});

test("a_failed_filesystem_check_is_reported_and_nothing_is_started", async () => {
  render(<Window />);
  pointerOver("row");
  ipc.sameFilesystem.mockRejectedValue({
    kind: "Io",
    message: "the disk went away",
    path: null,
    details: null,
  });
  await drop();
  expect(await screen.findByText(/the disk went away/)).toBeInTheDocument();
  expect(ipc.dropStartOp).not.toHaveBeenCalled();
});

test("a_text_file_dropped_on_the_documents_opens_as_a_tab_of_this_window", async () => {
  render(<Window />);
  pointerOver("docs");
  await drop({ paths: [p("/x/a.txt"), p("/x/b.txt")] });
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith(
      [p("/x/a.txt"), p("/x/b.txt")],
      "inside",
      "default"
    )
  );
  expect(ipc.dropStartOp).not.toHaveBeenCalled();
  expect(ipc.sameFilesystem).not.toHaveBeenCalled();
});

test("what_the_editor_cannot_open_is_named_and_left_alone", async () => {
  render(<Window />);
  pointerOver("docs");
  await drop({ paths: [p("/x/a.txt"), p("/x/paper.pdf")] });
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([p("/x/a.txt")], "inside", "default")
  );
  expect(await screen.findByText(/paper\.pdf is not a text file/)).toBeInTheDocument();
  ipc.openPaths.mockClear();
  await drop({ paths: [p("/x/paper.pdf")] });
  expect(ipc.openPaths).not.toHaveBeenCalled();
});

test("a_drop_anywhere_else_does_nothing", async () => {
  render(<Window />);
  pointerOver("bar");
  await drop();
  expect(ipc.dropStartOp).not.toHaveBeenCalled();
  expect(ipc.openPaths).not.toHaveBeenCalled();
  // The window says why (the status bar shows the notice).
  expect(useOps.getState().notice?.text).toMatch(/Files can be dropped on a folder of the tree/);
});

test("the_pointer_is_told_a_folder_the_documents_or_a_refusal", async () => {
  render(<Window />);
  await waitFor(() => expect(subscribed["kern://drag-over"]?.length ?? 0).toBeGreaterThan(0));
  const over = (id: string, drag: number) => {
    pointerOver(id);
    act(() =>
      subscribed["kern://drag-over"]!.forEach((h) =>
        h({
          drag,
          position: { x: 5, y: 5 },
          view: { width: window.innerWidth, height: window.innerHeight },
        })
      )
    );
  };
  over("row", 1);
  expect(ipc.dndTarget).toHaveBeenLastCalledWith(1, { state: "folder", path: p("/d/sub") });
  over("docs", 1);
  expect(ipc.dndTarget).toHaveBeenLastCalledWith(1, { state: "open" });
  over("bar", 1);
  expect(ipc.dndTarget).toHaveBeenLastCalledWith(1, {
    state: "refused",
    reason: expect.stringMatching(/tree/),
  });
  // The same place twice is said once.
  const calls = ipc.dndTarget.mock.calls.length;
  over("bar", 1);
  expect(ipc.dndTarget).toHaveBeenCalledTimes(calls);
});
