// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Binds, BindsPatch, WireError } from "../ipc";

const ipc = vi.hoisted(() => ({
  bindsGet: vi.fn(),
  bindsSet: vi.fn(),
  bindsClear: vi.fn(),
  errorLogAppend: vi.fn(),
  on: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { getAction } from "../keys/actions";
import { useBinds } from "../keys/binds";
import { KeysSection } from "./KeysSection";
import { SETTINGS } from "./test-settings";

const settle = () => act(async () => {});
const row = (label: string) => screen.getByRole("group", { name: label });
const add = (label: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Add a bind to ${label}` }));
const key = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);
const mouse = (button: number, init: MouseEventInit = {}) =>
  fireEvent.mouseDown(document.body, { button, ...init });
const failure: WireError = { kind: "Io", message: "disk full", path: null, details: null };

/** What the backend would answer: the patch applied to the stored binds. */
function answer(patch: BindsPatch): Binds {
  const binds = { ...useBinds.getState().overrides };
  for (const [id, list] of Object.entries(patch)) {
    if (list === null) delete binds[id];
    else binds[id] = list;
  }
  return { binds };
}

beforeEach(() => {
  useBinds.setState({ loaded: true, overrides: {}, error: null });
  ipc.bindsGet.mockReset().mockResolvedValue({ binds: {} });
  ipc.bindsSet
    .mockReset()
    .mockImplementation((patch: BindsPatch) => Promise.resolve(answer(patch)));
  ipc.bindsClear.mockReset().mockResolvedValue({ binds: {} });
  ipc.errorLogAppend.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

test("every_action_is_listed_under_its_area_with_the_binds_it_has", () => {
  render(<KeysSection settings={SETTINGS} />);
  expect(screen.getByRole("heading", { name: "Tabs" })).toBeInTheDocument();
  const close = within(row("Close tab"));
  expect(close.getByText("Ctrl+W")).toBeInTheDocument();
  expect(close.getByText("MiddleClick")).toBeInTheDocument();
  expect(close.getByText("Anywhere")).toBeInTheDocument();
});

test("a_user_bind_replaces_the_defaults_in_the_list_and_is_marked", () => {
  useBinds.setState({ overrides: { "tab.close": ["F9"] } });
  render(<KeysSection settings={SETTINGS} />);
  const close = within(row("Close tab"));
  expect(close.getByText("F9")).toBeInTheDocument();
  expect(close.queryByText("Ctrl+W")).toBeNull();
  expect(close.getByText("Changed")).toBeInTheDocument();
  expect(within(row("Next tab")).queryByText("Changed")).toBeNull();
});

test("the_filter_narrows_the_list_by_name_or_bind_and_says_when_nothing_matches", () => {
  render(<KeysSection settings={SETTINGS} />);
  const filter = screen.getByRole("searchbox", { name: "Filter actions" });
  fireEvent.change(filter, { target: { value: "ctrl+w" } });
  expect(screen.getByRole("group", { name: "Close tab" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Next tab" })).toBeNull();
  fireEvent.change(filter, { target: { value: "no such action" } });
  expect(screen.getByRole("status")).toHaveTextContent(/no action matches/i);
});

test("a_key_pressed_after_add_is_added_to_the_action_and_stored_at_once", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Close tab");
  expect(screen.getByRole("status")).toHaveTextContent(/press a key or click a mouse button/i);
  key({ key: "q", ctrlKey: true });
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledWith({ "tab.close": ["Ctrl+W", "MiddleClick", "Ctrl+Q"] });
  expect(within(row("Close tab")).getByText("Ctrl+Q")).toBeInTheDocument();
  // The capture is over: the next key is nobody's.
  key({ key: "x", ctrlKey: true });
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledTimes(1);
});

test("a_modifier_alone_waits_and_escape_cancels", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Close tab");
  key({ key: "Control", ctrlKey: true });
  key({ key: "Shift", shiftKey: true });
  await settle();
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/press a key/i);
  key({ key: "Escape" });
  await settle();
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

test("the_cancel_button_ends_the_capture_and_a_click_on_it_is_not_a_bind", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Close tab");
  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.mouseDown(cancel, { button: 0 });
  fireEvent.click(cancel);
  await settle();
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

test("a_mouse_button_clicked_after_add_is_added_with_its_modifiers", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Next tab");
  mouse(3, { ctrlKey: true });
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledWith({
    "tab.next": [...getAction("tab.next").keys, "Ctrl+MouseBack"],
  });
});

test("a_plain_left_or_right_click_is_refused_with_the_reason_and_the_capture_goes_on", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Next tab");
  mouse(0);
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(/plain left click/i);
  mouse(2);
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(/plain right click/i);
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  mouse(1);
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledOnce();
});

test("a_bind_the_action_already_has_is_said_and_nothing_is_stored", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Close tab");
  key({ key: "w", ctrlKey: true });
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(/Close tab already has Ctrl\+W/);
  expect(ipc.bindsSet).not.toHaveBeenCalled();
});

test("a_bind_another_action_holds_asks_before_taking_it_and_moves_it_in_one_write", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Next tab");
  key({ key: "w", ctrlKey: true });
  await settle();
  const ask = screen.getByRole("alert");
  expect(ask).toHaveTextContent(/Ctrl\+W is Close tab/);
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: /take it/i }));
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledOnce();
  expect(ipc.bindsSet).toHaveBeenCalledWith({
    "tab.next": [...getAction("tab.next").keys, "Ctrl+W"],
    "tab.close": ["MiddleClick"],
  });
});

test("declining_a_taken_bind_changes_nothing", async () => {
  render(<KeysSection settings={SETTINGS} />);
  add("Next tab");
  key({ key: "w", ctrlKey: true });
  await settle();
  fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: /keep it/i }));
  await settle();
  expect(ipc.bindsSet).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_bind_is_removed_with_its_button_and_the_last_one_leaves_the_action_unbound", async () => {
  render(<KeysSection settings={SETTINGS} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove MiddleClick from Close tab" }));
  await settle();
  expect(ipc.bindsSet).toHaveBeenLastCalledWith({ "tab.close": ["Ctrl+W"] });
  fireEvent.click(screen.getByRole("button", { name: "Remove Ctrl+W from Close tab" }));
  await settle();
  expect(ipc.bindsSet).toHaveBeenLastCalledWith({ "tab.close": [] });
  expect(within(row("Close tab")).getByText("No bind")).toBeInTheDocument();
});

test("reset_gives_one_action_its_defaults_back_and_is_there_only_for_a_changed_one", async () => {
  useBinds.setState({ overrides: { "tab.close": ["F9"] } });
  render(<KeysSection settings={SETTINGS} />);
  expect(within(row("Next tab")).queryByRole("button", { name: /reset/i })).toBeNull();
  fireEvent.click(within(row("Close tab")).getByRole("button", { name: "Reset Close tab" }));
  await settle();
  expect(ipc.bindsSet).toHaveBeenCalledWith({ "tab.close": null });
  expect(within(row("Close tab")).getByText("Ctrl+W")).toBeInTheDocument();
});

test("a_write_that_fails_is_said_with_the_reason_and_the_list_is_as_it_was", async () => {
  ipc.bindsSet.mockRejectedValue(failure);
  render(<KeysSection settings={SETTINGS} />);
  add("Close tab");
  key({ key: "q", ctrlKey: true });
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved.*disk full/i);
  expect(within(row("Close tab")).queryByText("Ctrl+Q")).toBeNull();
});

test("reset_all_asks_with_cancel_focused_and_deletes_the_file_only_on_yes", async () => {
  useBinds.setState({ overrides: { "tab.close": ["F9"] } });
  render(<KeysSection settings={SETTINGS} />);
  fireEvent.click(screen.getByRole("button", { name: "Reset all binds" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.bindsClear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reset all binds" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset all binds" })
  );
  await settle();
  expect(ipc.bindsClear).toHaveBeenCalledOnce();
  expect(screen.getByText("Every bind is back to its default.")).toBeInTheDocument();
});

test("binds_that_could_not_be_read_say_so_and_retry_reads_them_again", async () => {
  useBinds.setState({ loaded: false, error: failure });
  ipc.bindsGet.mockRejectedValue(failure);
  render(<KeysSection settings={SETTINGS} />);
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not be read.*disk full/i);
  ipc.bindsGet.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await settle();
  expect(ipc.bindsGet).toHaveBeenCalled();
});
