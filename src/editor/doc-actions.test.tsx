// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ pin: vi.fn(), unpin: vi.fn(), pinsGet: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import {
  actions,
  appliesTo,
  currentContext,
  findDuplicateBindings,
  getAction,
  menuSections,
  runAction,
} from "../keys/actions";
import { useShortcuts } from "../keys/useShortcuts";
import { useOps } from "../ops/useOps";
import { usePinnedRecent } from "../shell/pinned-recent-store";
import { useTabs } from "../store/tabs";
import { useCloseGuard } from "../shell/useCloseGuard";
import { docController, registerDoc, type DocController } from "./doc-controller";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const DOC = p("/home/a/n.md");

/** A document controller whose every command is a stub, with `over` for the ones a test uses. */
const fakeDoc = (over: Partial<DocController>): DocController => ({
  save: vi.fn(),
  askSaveAs: vi.fn(),
  canSave: () => false,
  canSaveAs: () => false,
  closeRisk: () => null,
  saveForClose: () => Promise.resolve(true),
  snapshot: () => null,
  setMoving: vi.fn(),
  busy: () => false,
  whySaveRefused: () => null,
  ...over,
});

function Host() {
  useShortcuts();
  return <div data-testid="ce" contentEditable suppressContentEditableWarning />;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [
      { id: "f", kind: "folder", path: p("/home/a"), history: [p("/home/a")], cursor: 0 },
      { id: "d", kind: "doc", path: DOC, dirty: false },
    ],
    activeId: "d",
  });
  ipc.pinsGet.mockResolvedValue({ entries: [] });
  ipc.pin.mockResolvedValue({ entries: [DOC] });
  ipc.unpin.mockResolvedValue({ entries: [] });
});

test("the_document_actions_are_in_the_table_the_menu_and_bind_each_key_once", () => {
  for (const [id, key, label] of [
    ["doc.save", "Ctrl+S", "Save"],
    ["doc.saveAs", "Ctrl+Shift+S", "Save As…"],
    ["doc.pin", "Ctrl+D", "Pin"],
  ] as const) {
    const a = getAction(id);
    expect(a.keys).toEqual([key]);
    expect(a.label).toBe(label);
    expect(a.when).toBe("doc");
    // The focus is in CodeMirror's contenteditable when these are used.
    expect(a.inEditable).toBe(true);
    const doc = useTabs.getState().tabs[1]!;
    expect(menuSections(doc).flatMap((s) => s.actions.map((x) => x.id))).toContain(id);
    expect(menuSections(useTabs.getState().tabs[0]!).flatMap((s) => s.actions)).not.toContain(a);
  }
  expect(findDuplicateBindings()).toEqual([]);
});

test("the_folder_keys_do_not_fire_while_the_focus_is_in_the_editor", () => {
  const doc = useTabs.getState().tabs[1]!;
  // Nothing that applies to a document tab and fires in an editable field takes these keys.
  for (const key of [
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
    "Ctrl+A",
    "Ctrl+F",
    "Ctrl+C",
    "Ctrl+V",
    "Ctrl+X",
    "Delete",
    "Shift+Delete",
    "F2",
  ]) {
    const hits = actions.filter(
      (a) => a.keys.includes(key) && appliesTo(a, doc) && a.inEditable === true
    );
    expect(
      hits.map((a) => a.id),
      key
    ).toEqual([]);
  }
  // And at the window: the keys reach CodeMirror's own handlers untouched.
  const runUndo = vi.spyOn(useOps.getState(), "runUndo");
  const { getByTestId } = render(<Host />);
  const ce = getByTestId("ce");
  ce.focus();
  for (const [key, mods] of [
    ["z", { ctrlKey: true }],
    ["y", { ctrlKey: true }],
    ["a", { ctrlKey: true }],
    ["f", { ctrlKey: true }],
    ["c", { ctrlKey: true }],
    ["v", { ctrlKey: true }],
    ["x", { ctrlKey: true }],
    ["Delete", {}],
  ] as const) {
    const notClaimed = fireEvent.keyDown(ce, { key, ...mods });
    expect(notClaimed, key).toBe(true);
  }
  expect(runUndo).not.toHaveBeenCalled();
});

test("ctrl_s_and_ctrl_shift_s_reach_the_editor_of_the_active_document_in_an_editable_field", () => {
  const save = vi.fn();
  const askSaveAs = vi.fn();
  const off = registerDoc(
    "d",
    fakeDoc({ save, askSaveAs, canSave: () => true, canSaveAs: () => true })
  );
  const { getByTestId } = render(<Host />);
  const ce = getByTestId("ce");
  ce.focus();
  expect(fireEvent.keyDown(ce, { key: "s", ctrlKey: true })).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
  expect(fireEvent.keyDown(ce, { key: "s", ctrlKey: true, shiftKey: true })).toBe(false);
  expect(askSaveAs).toHaveBeenCalledTimes(1);
  off();
  expect(docController("d")).toBeUndefined();
});

test("ctrl_s_that_cannot_save_says_why_in_the_status_bar_and_a_clean_document_says_nothing", () => {
  const save = vi.fn();
  registerDoc(
    "d",
    fakeDoc({
      save,
      canSave: () => false,
      whySaveRefused: () => "This file is read-only. Use Save As.",
    })
  );
  const { getByTestId } = render(<Host />);
  const ce = getByTestId("ce");
  ce.focus();
  // The key is claimed, nothing is saved, and the reason is in the status bar.
  expect(fireEvent.keyDown(ce, { key: "s", ctrlKey: true })).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toBe("This file is read-only. Use Save As.");
  // A document with nothing to save has no reason to give.
  useOps.setState({ notice: null });
  registerDoc("d", fakeDoc({ save, canSave: () => false, whySaveRefused: () => null }));
  fireEvent.keyDown(ce, { key: "s", ctrlKey: true });
  expect(useOps.getState().notice).toBeNull();
});

test("save_is_greyed_when_the_editor_says_there_is_nothing_to_save", () => {
  const save = vi.fn();
  registerDoc("d", fakeDoc({ save, canSave: () => false, canSaveAs: () => true }));
  expect(runAction(getAction("doc.save"), currentContext())).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(runAction(getAction("doc.saveAs"), currentContext())).toBe(true);
});

test("ctrl_d_pins_the_document_and_unpins_it_when_pinned", async () => {
  expect(getAction("doc.pin").menuLabel?.()).toBe("Pin");
  expect(runAction(getAction("doc.pin"), currentContext())).toBe(true);
  // No pins read yet: they are read first, never guessed.
  await vi.waitFor(() => expect(ipc.pin).toHaveBeenCalledWith(DOC));
  expect(ipc.pinsGet).toHaveBeenCalledTimes(1);
  // A document tab folds Pinned and Recent away: the outcome is in the status bar.
  await vi.waitFor(() => expect(useOps.getState().notice?.text).toBe("Pinned n.md"));

  // The store takes the backend's answer, so the label is right without its event.
  expect(usePinnedRecent.getState().pins).toEqual([DOC]);
  expect(getAction("doc.pin").menuLabel?.()).toBe("Unpin");
  runAction(getAction("doc.pin"), currentContext());
  await vi.waitFor(() => expect(ipc.unpin).toHaveBeenCalledWith(DOC));
  await vi.waitFor(() => expect(useOps.getState().notice?.text).toBe("Unpinned n.md"));
  expect(ipc.pin).toHaveBeenCalledTimes(1);
  expect(ipc.pinsGet).toHaveBeenCalledTimes(1);
});

test("a_failed_pin_lookup_is_said_in_the_status_bar_and_pins_nothing", async () => {
  ipc.pinsGet.mockRejectedValue({ kind: "Io", message: "unreadable", path: null, details: null });
  runAction(getAction("doc.pin"), currentContext());
  await vi.waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(
      /^Kern could not read the pins, so n\.md was left as it was: .*unreadable/
    )
  );
  expect(ipc.pin).not.toHaveBeenCalled();
  expect(ipc.unpin).not.toHaveBeenCalled();
});

test("a_failed_pin_or_unpin_is_said_in_the_status_bar", async () => {
  ipc.pin.mockRejectedValue({ kind: "Io", message: "disk full", path: null, details: null });
  runAction(getAction("doc.pin"), currentContext());
  await vi.waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(/^n\.md could not be pinned: .*disk full/)
  );
  usePinnedRecent.setState({ pins: [DOC] });
  ipc.unpin.mockRejectedValue({ kind: "Io", message: "read-only", path: null, details: null });
  runAction(getAction("doc.pin"), currentContext());
  await vi.waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(/^n\.md could not be unpinned: .*read-only/)
  );
});

test("a_document_that_would_lose_something_asks_before_it_closes", async () => {
  registerDoc(
    "d",
    fakeDoc({ closeRisk: () => ({ dirty: true, deleted: false, readOnly: false }) })
  );
  const close = getAction("tab.close");
  expect(runAction(close, currentContext("d"))).toBe(true);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "d"]);
  expect(useCloseGuard.getState().question).toMatchObject({
    what: "tab",
    items: [{ id: "d", name: "n.md", dirty: true, deleted: false }],
  });
  // A second close while the question is open does nothing.
  runAction(close, currentContext("d"));
  act(() => useCloseGuard.getState().answer("discard"));
  await vi.waitFor(() => expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f"]));
  expect(useCloseGuard.getState().question).toBeNull();
});

test("a_document_that_would_lose_nothing_and_a_folder_close_at_once", () => {
  registerDoc("d", fakeDoc({}));
  const close = getAction("tab.close");
  runAction(close, currentContext("d"));
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f"]);
  runAction(close, currentContext("f"));
  expect(useTabs.getState().tabs).toEqual([]);
  expect(useCloseGuard.getState().question).toBeNull();
});

test("the_tab_store_keeps_dirty_and_follows_a_save_as", () => {
  useTabs.getState().setDirty("d", true);
  expect(useTabs.getState().tabs[1]).toMatchObject({ dirty: true });
  useTabs.getState().setDirty("d", true);
  useTabs.getState().setDirty("nope", true);
  useTabs.getState().setDirty("f", true);
  expect(useTabs.getState().tabs[0]).not.toHaveProperty("dirty");
  useTabs.getState().retargetDoc("d", p("/home/a/other.md"));
  expect(useTabs.getState().tabs[1]).toMatchObject({ path: p("/home/a/other.md"), dirty: true });
  useTabs.getState().retargetDoc("f", p("/x"));
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: p("/home/a") });
});
