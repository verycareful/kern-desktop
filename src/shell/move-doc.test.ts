// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  detachDoc: vi.fn(),
  moveDocToMain: vi.fn(),
  currentWindowLabel: vi.fn(),
  isMainWindow: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { registerDoc, type DocController } from "../editor/doc-controller";
import type { HandedDoc } from "../editor/handed-doc";
import { currentContext, getAction, isEnabled } from "../keys/actions";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { moveDocHome, moveTabToWindow } from "./move-doc";
import { useCloseGuard } from "./useCloseGuard";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const DOC = p("/home/a/n.md");
const STATE: HandedDoc = {
  text: "mine",
  saved: "hello",
  stamp: "s",
  ending: "lf",
  bom: false,
  read_only: null,
};

let moving: boolean[];
let off: () => void;
const controller = (over: Partial<DocController> = {}): DocController => ({
  save: vi.fn(),
  askSaveAs: vi.fn(),
  canSave: () => true,
  canSaveAs: () => true,
  // Unsaved text: closing it the ordinary way would ask.
  closeRisk: () => ({ dirty: true, deleted: false, readOnly: false }),
  saveForClose: () => Promise.resolve(true),
  snapshot: () => STATE,
  setMoving: (m) => moving.push(m),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  moving = [];
  useOps.setState({ notice: null });
  useCloseGuard.getState().reset();
  ipc.isMainWindow.mockReturnValue(true);
  ipc.currentWindowLabel.mockReturnValue("doc-1");
  useTabs.setState({
    tabs: [
      { id: "f", kind: "folder", path: p("/home/a"), history: [p("/home/a")], cursor: 0 },
      { id: "d", kind: "doc", path: DOC, dirty: true },
    ],
    activeId: "d",
  });
});
afterEach(() => off?.());

test("move_to_new_window_hands_over_the_text_and_closes_the_tab_without_asking", async () => {
  off = registerDoc("d", controller());
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("d");
  expect(ipc.detachDoc).toHaveBeenCalledWith("d", DOC, STATE);
  expect(moving).toEqual([true]);
  // The window holds the text now: no question, and the tab goes.
  expect(useCloseGuard.getState().question).toBeNull();
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f"]);
});

test("a_failed_move_keeps_the_tab_editable_and_says_why", async () => {
  off = registerDoc("d", controller());
  ipc.detachDoc.mockRejectedValue({ kind: "AlreadyOpen", message: "in doc-2", path: null });
  await moveTabToWindow("d");
  expect(moving).toEqual([true, false]);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
  expect(useOps.getState().notice?.text).toMatch(
    /n\.md could not be moved to a new window: .*in doc-2/
  );
});

test("a_document_that_holds_no_text_moves_without_a_state_and_the_window_reads_it", async () => {
  off = registerDoc("d", controller({ snapshot: () => null }));
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("d");
  expect(ipc.detachDoc).toHaveBeenCalledWith("d", DOC, null);
});

test("home_sends_the_window_state_and_on_failure_gives_editing_back", async () => {
  off = registerDoc("doc-1", controller());
  ipc.moveDocToMain.mockResolvedValue(undefined);
  expect(await moveDocHome()).toBeNull();
  expect(ipc.moveDocToMain).toHaveBeenCalledWith("doc-1", STATE);
  // On success the backend closes the window; editing is not given back.
  expect(moving).toEqual([true]);

  ipc.moveDocToMain.mockRejectedValue({ kind: "AdoptTimeout", message: "no answer", path: null });
  expect(await moveDocHome()).toMatch(/stays here: .*no answer/);
  expect(moving).toEqual([true, true, false]);
});

test("move_to_new_window_is_offered_for_a_document_tab_of_the_main_window_only", () => {
  const detach = getAction("tab.detach");
  expect(detach.keys).toEqual([]);
  expect(isEnabled(detach, currentContext("d"))).toBe(true);
  expect(isEnabled(detach, currentContext("f"))).toBe(false);
  ipc.isMainWindow.mockReturnValue(false);
  expect(isEnabled(detach, currentContext("d"))).toBe(false);
});
