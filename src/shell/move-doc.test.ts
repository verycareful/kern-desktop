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
  whySaveRefused: () => null,
  // Unsaved text: closing it the ordinary way would ask.
  closeRisk: () => ({ dirty: true, deleted: false, readOnly: false }),
  saveForClose: () => Promise.resolve(true),
  snapshot: () => STATE,
  setMoving: (m) => moving.push(m),
  busy: () => moving[moving.length - 1] === true,
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

test("a_move_the_new_window_did_not_acknowledge_keeps_the_tab_and_its_text_and_says_why", async () => {
  off = registerDoc("d", controller());
  ipc.detachDoc.mockRejectedValue({
    kind: "DetachTimeout",
    message: "the new window did not take the document; it stays in its tab",
    path: null,
  });
  await moveTabToWindow("d");
  // The tab is still there with its text, editable again; nothing closed it.
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
  expect(moving).toEqual([true, false]);
  expect(useOps.getState().notice?.text).toMatch(/stays in its tab/);
});

test("the_tab_closes_only_after_the_move_has_been_acknowledged", async () => {
  off = registerDoc("d", controller());
  let acknowledge!: (label: string) => void;
  ipc.detachDoc.mockImplementation(() => new Promise<string>((r) => (acknowledge = r)));
  const moved = moveTabToWindow("d");
  await Promise.resolve();
  // The backend has not answered: the window may not hold the text yet.
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
  acknowledge("doc-1");
  await moved;
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f"]);
});

test("a_document_that_holds_no_text_moves_without_a_state_and_the_window_reads_it", async () => {
  off = registerDoc("d", controller({ snapshot: () => null }));
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("d");
  expect(ipc.detachDoc).toHaveBeenCalledWith("d", DOC, null);
});

test("home_sends_the_window_state_and_on_failure_gives_editing_back", async () => {
  off = registerDoc("doc-1", controller());
  ipc.moveDocToMain.mockRejectedValue({
    kind: "AdoptRefused",
    message: "already open",
    path: null,
  });
  expect(await moveDocHome()).toMatch(/stays here: .*already open/);
  expect(ipc.moveDocToMain).toHaveBeenCalledWith("doc-1", STATE);
  expect(moving).toEqual([true, false]);

  ipc.moveDocToMain.mockResolvedValue(undefined);
  expect(await moveDocHome()).toBeNull();
  // On success the backend closes the window; editing is not given back.
  expect(moving).toEqual([true, false, true]);
});

test("a_second_move_while_one_is_under_way_is_refused_and_leaves_the_first_alone", async () => {
  off = registerDoc("d", controller());
  let finish!: (label: string) => void;
  ipc.detachDoc.mockImplementation(() => new Promise((r) => (finish = r)));
  const first = moveTabToWindow("d");
  expect(isEnabled(getAction("tab.detach"), currentContext("d"))).toBe(false);
  await moveTabToWindow("d");
  expect(ipc.detachDoc).toHaveBeenCalledTimes(1);
  expect(useOps.getState().notice?.text).toMatch(
    /n\.md was not moved to a new window: it is being saved or moved/
  );
  // The first move is not unfrozen by the refused one.
  expect(moving).toEqual([true]);
  finish("doc-1");
  await first;
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f"]);
  expect(await moveDocHome()).toBeNull();
});

test("a_tab_whose_text_changed_during_the_move_stays", async () => {
  let text = "mine";
  off = registerDoc("d", controller({ snapshot: () => ({ ...STATE, text }) }));
  ipc.detachDoc.mockImplementation(async () => {
    text = "mine and more";
    return "doc-1";
  });
  await moveTabToWindow("d");
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
  expect(moving).toEqual([true, false]);
  expect(useOps.getState().notice?.text).toMatch(/keeps the changes made since/);
});

test("a_state_that_would_not_arrive_whole_is_not_sent", async () => {
  // A field JSON does not carry: an undefined value is dropped on the way.
  off = registerDoc("d", controller({ snapshot: () => ({ ...STATE, stamp: undefined as never }) }));
  await moveTabToWindow("d");
  expect(ipc.detachDoc).not.toHaveBeenCalled();
  expect(moving).toEqual([]);
  expect(useOps.getState().notice?.text).toMatch(/could not be prepared for the other window/);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
});

test("move_to_new_window_is_offered_for_a_document_tab_of_the_main_window_only", () => {
  const detach = getAction("tab.detach");
  expect(detach.keys).toEqual([]);
  expect(isEnabled(detach, currentContext("d"))).toBe(true);
  expect(isEnabled(detach, currentContext("f"))).toBe(false);
  ipc.isMainWindow.mockReturnValue(false);
  expect(isEnabled(detach, currentContext("d"))).toBe(false);
});
