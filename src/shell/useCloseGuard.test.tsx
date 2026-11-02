// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ confirmClose: vi.fn(), isMainWindow: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { registerDoc as register, type DocController } from "../editor/doc-controller";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { ClosePrompt } from "./ClosePrompt";
import { closeTab, closeWindow, mayClose, useCloseGuard } from "./useCloseGuard";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const doc = (over: Partial<DocController>): DocController => ({
  save: vi.fn(),
  askSaveAs: vi.fn(),
  canSave: () => false,
  canSaveAs: () => false,
  closeRisk: () => null,
  saveForClose: vi.fn(() => Promise.resolve(true)),
  snapshot: () => null,
  setMoving: vi.fn(),
  busy: () => false,
  ...over,
});
/** Registrations made by a test, removed after it. */
const offs: (() => void)[] = [];
const registerDoc = (id: string, c: DocController) => offs.push(register(id, c));
afterEach(() => offs.splice(0).forEach((off) => off()));

const dirty = { dirty: true, deleted: false, readOnly: false };
const deleted = { dirty: false, deleted: true, readOnly: false };

beforeEach(() => {
  vi.clearAllMocks();
  ipc.confirmClose.mockResolvedValue(undefined);
  ipc.isMainWindow.mockReturnValue(true);
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [
      { id: "f", kind: "folder", path: p("/home/a"), history: [p("/home/a")], cursor: 0 },
      { id: "a", kind: "doc", path: p("/home/a/a.md"), dirty: false },
      { id: "b", kind: "doc", path: p("/home/a/b.md"), dirty: false },
    ],
    activeId: "f",
  });
});

const answer = (choice: "save" | "discard" | "cancel") =>
  act(() => useCloseGuard.getState().answer(choice));

test("a_clean_document_whose_file_was_deleted_asks_before_it_closes", async () => {
  // Its text is the only copy left (maintainer, 2026-11-02).
  registerDoc("a", doc({ closeRisk: () => deleted }));
  render(<ClosePrompt />);
  act(() => closeTab("a"));
  const prompt = await screen.findByTestId("close-prompt");
  expect(prompt).toHaveTextContent("Save a.md again before closing?");
  expect(prompt).toHaveTextContent(/deleted on disk; this is the only copy of its text/);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "a", "b"]);
});

test("save_all_stops_at_the_first_document_that_was_not_saved_and_closes_nothing", async () => {
  const saveA = vi.fn(() => Promise.resolve(false));
  const saveB = vi.fn(() => Promise.resolve(true));
  registerDoc("a", doc({ closeRisk: () => dirty, saveForClose: saveA }));
  registerDoc("b", doc({ closeRisk: () => dirty, saveForClose: saveB }));
  let result: Promise<boolean> = Promise.resolve(true);
  act(() => {
    result = mayClose(["a", "b"], "window");
  });
  answer("save");
  expect(await result).toBe(false);
  expect(saveA).toHaveBeenCalledTimes(1);
  expect(saveB).not.toHaveBeenCalled();
  // The user is taken to it; its editor shows why.
  expect(useTabs.getState().activeId).toBe("a");
  expect(useOps.getState().notice?.text).toBe("a.md was not saved, so nothing was closed.");
  expect(useCloseGuard.getState().question).toBeNull();
});

test("save_all_saves_each_in_turn_then_lets_the_close_go_on", async () => {
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  registerDoc(
    "a",
    doc({
      closeRisk: () => dirty,
      saveForClose: async () => {
        order.push("a");
        await held;
        return true;
      },
    })
  );
  registerDoc(
    "b",
    doc({ closeRisk: () => deleted, saveForClose: async () => (order.push("b"), true) })
  );
  render(<ClosePrompt />);
  let result: Promise<boolean> = Promise.resolve(false);
  act(() => {
    result = mayClose(["f", "a", "b"], "window");
  });
  expect(useCloseGuard.getState().question?.items.map((i) => i.id)).toEqual(["a", "b"]);
  answer("save");
  await act(async () => {});
  // While it writes the question stays, saying so, and nothing in it can be pressed.
  expect(screen.getByTestId("close-prompt")).toHaveTextContent("Saving…");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(order).toEqual(["a"]);
  await act(async () => release());
  expect(await result).toBe(true);
  expect(order).toEqual(["a", "b"]);
  expect(screen.queryByTestId("close-prompt")).toBeNull();
});

test("a_read_only_document_offers_no_save_and_says_save_as", async () => {
  registerDoc("a", doc({ closeRisk: () => ({ dirty: true, deleted: false, readOnly: true }) }));
  render(<ClosePrompt />);
  act(() => closeTab("a"));
  const prompt = await screen.findByTestId("close-prompt");
  expect(within(prompt).queryByRole("button", { name: /^Save/ })).toBeNull();
  expect(prompt).toHaveTextContent(/a\.md is read-only here\. Cancel, then use Save As/);
  expect(within(prompt).getByRole("button", { name: "Cancel" })).toHaveFocus();
});

test("escape_is_cancel", async () => {
  registerDoc("a", doc({ closeRisk: () => dirty }));
  render(<ClosePrompt />);
  act(() => closeTab("a"));
  fireEvent.keyDown(await screen.findByTestId("close-prompt"), { key: "Escape" });
  expect(screen.queryByTestId("close-prompt")).toBeNull();
  await act(async () => {});
  expect(useTabs.getState().tabs).toHaveLength(3);
});

test("a_question_asked_right_after_another_was_cancelled_stays_open", async () => {
  registerDoc("a", doc({ closeRisk: () => dirty }));
  registerDoc("b", doc({ closeRisk: () => dirty }));
  act(() => closeTab("a"));
  answer("cancel");
  // Before the first close has finished: the second question is its own.
  act(() => closeTab("b"));
  await act(async () => {});
  expect(useCloseGuard.getState().question?.items.map((i) => i.id)).toEqual(["b"]);
  answer("discard");
  await vi.waitFor(() => expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["f", "a"]));
});

test("closing_the_document_of_a_document_window_closes_the_window", async () => {
  ipc.isMainWindow.mockReturnValue(false);
  useTabs.setState({
    tabs: [{ id: "doc-1", kind: "doc", path: p("/home/a/a.md"), dirty: false }],
    activeId: "doc-1",
  });
  registerDoc("doc-1", doc({ closeRisk: () => dirty }));
  act(() => closeTab("doc-1"));
  expect(useCloseGuard.getState().question?.what).toBe("window");
  answer("discard");
  await vi.waitFor(() => expect(ipc.confirmClose).toHaveBeenCalledTimes(1));
});

test("a_window_whose_close_fails_says_why", async () => {
  ipc.confirmClose.mockRejectedValue({ kind: "Io", message: "busy", path: null, details: null });
  await closeWindow();
  expect(useOps.getState().notice?.text).toMatch(/The window could not be closed: .*busy/);
});

test("a_close_asked_for_while_a_question_is_open_says_so", async () => {
  registerDoc("a", doc({ closeRisk: () => dirty }));
  registerDoc("b", doc({ closeRisk: () => dirty }));
  act(() => closeTab("a"));
  act(() => closeTab("b"));
  await act(async () => {});
  expect(useCloseGuard.getState().question?.items.map((i) => i.id)).toEqual(["a"]);
  expect(useOps.getState().notice?.text).toBe(
    "Kern is already asking about closing. Answer that question first."
  );
  expect(useTabs.getState().tabs).toHaveLength(3);
});

test("a_document_that_arrives_while_the_others_are_saved_is_asked_about_before_the_close", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  registerDoc(
    "a",
    doc({
      closeRisk: () => dirty,
      saveForClose: async () => {
        await held;
        return true;
      },
    })
  );
  // Once saved, a is no longer at risk.
  const closing = closeWindow();
  answer("save");
  await act(async () => {});
  // b arrives (Home in a document window) while a is being written.
  registerDoc("b", doc({ closeRisk: () => dirty }));
  offs.push(register("a", doc({ closeRisk: () => null })));
  await act(async () => release());
  await vi.waitFor(() =>
    expect(useCloseGuard.getState().question?.items.map((i) => i.id)).toEqual(["b"])
  );
  expect(ipc.confirmClose).not.toHaveBeenCalled();
  answer("cancel");
  await closing;
  expect(ipc.confirmClose).not.toHaveBeenCalled();
});
