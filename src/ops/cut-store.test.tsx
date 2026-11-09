// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { pathKey, type WireError, type WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  clipGet: vi.fn(),
  clipClearIf: vi.fn(),
  errorLogAppend: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { FILE_KEYS_ATTR, NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { cancelCut, clearCut, refreshCut, setCut, useCut, useCutSync } from "./cut-store";

// The files greyed as cut are the files the system clipboard holds as a cut, read when the
// window gets the focus; Escape cancels the cut.

const p = (v: string): WirePath => ({ k: "Utf8", v });
const err = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});
const k = (v: string) => pathKey(p(v));
const keys = () => [...useCut.getState().keys].sort();
const settle = () => act(async () => {});

function Host(props: { zone?: "files" | "other"; children?: React.ReactNode }) {
  useCutSync();
  const attr =
    props.zone === "files"
      ? { [FILE_KEYS_ATTR]: "" }
      : props.zone === "other"
        ? { [NO_FILE_KEYS_ATTR]: "" }
        : {};
  return (
    <div data-testid="zone" {...attr}>
      <button type="button" data-testid="target">
        x
      </button>
      {props.children}
    </div>
  );
}

const escape = (target: Element, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};

beforeEach(() => {
  clearCut();
  ipc.clipGet.mockResolvedValue(null);
  ipc.clipClearIf.mockResolvedValue(true);
  ipc.errorLogAppend.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("what_the_clipboard_holds_as_a_cut_is_what_is_cut", async () => {
  ipc.clipGet.mockResolvedValue({ op: "cut", paths: [p("/d/a"), p("/d/b")] });
  await refreshCut();
  expect(keys()).toEqual([k("/d/a"), k("/d/b")]);
});

test.each([
  ["a_copy", { op: "copy", paths: [p("/d/a")] }],
  ["nothing_that_is_files", null],
])("%s_on_the_clipboard_greys_nothing", async (_name, held) => {
  setCut([p("/d/a")]);
  ipc.clipGet.mockResolvedValue(held);
  await refreshCut();
  expect(keys()).toEqual([]);
});

test("a_read_that_fails_leaves_the_state_and_is_logged_unless_it_is_a_window_without_focus", async () => {
  setCut([p("/d/a")]);
  ipc.clipGet.mockRejectedValueOnce(err("NoFocus"));
  await refreshCut();
  expect(keys()).toEqual([k("/d/a")]);
  expect(ipc.errorLogAppend).not.toHaveBeenCalled();
  ipc.clipGet.mockRejectedValueOnce(err("Timeout", "the clipboard owner did not answer"));
  await refreshCut();
  expect(keys()).toEqual([k("/d/a")]);
  expect(ipc.errorLogAppend).toHaveBeenCalledWith(
    "clipboard",
    expect.stringContaining("did not answer")
  );
});

test("the_window_reads_the_clipboard_when_it_starts_and_each_time_it_gets_the_focus", async () => {
  render(<Host />);
  await settle();
  expect(ipc.clipGet).toHaveBeenCalledTimes(1);
  ipc.clipGet.mockResolvedValue({ op: "cut", paths: [p("/d/x")] });
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  expect(ipc.clipGet).toHaveBeenCalledTimes(2);
  expect(keys()).toEqual([k("/d/x")]);
  // Something else was copied in another application.
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/d/x")] });
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  expect(keys()).toEqual([]);
});

test("cancelling_clears_the_clipboard_of_exactly_this_cut_and_the_grey_goes", async () => {
  setCut([p("/d/a")]);
  expect(await cancelCut()).toBe(true);
  expect(ipc.clipClearIf).toHaveBeenCalledExactlyOnceWith("cut", [p("/d/a")]);
  expect(keys()).toEqual([]);
});

test("cancelling_with_no_cut_does_nothing", async () => {
  expect(await cancelCut()).toBe(false);
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
});

test("a_cancel_that_could_not_clear_keeps_the_grey_and_says_why", async () => {
  setCut([p("/d/a")]);
  ipc.clipClearIf.mockRejectedValueOnce(err("Timeout", "the clipboard owner did not answer"));
  expect(await cancelCut()).toBe(false);
  expect(keys()).toEqual([k("/d/a")]);
  expect(ipc.errorLogAppend).toHaveBeenCalled();
});

test("escape_in_the_files_cancels_the_cut", async () => {
  const { getByTestId } = render(<Host zone="files" />);
  await settle();
  setCut([p("/d/a")]);
  const e = escape(getByTestId("target"));
  await settle();
  expect(e.defaultPrevented).toBe(true);
  expect(ipc.clipClearIf).toHaveBeenCalledExactlyOnceWith("cut", [p("/d/a")]);
});

test("escape_does_nothing_without_a_cut_and_leaves_the_key_alone", async () => {
  const { getByTestId } = render(<Host zone="files" />);
  await settle();
  const e = escape(getByTestId("target"));
  expect(e.defaultPrevented).toBe(false);
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
});

test("escape_in_a_search_or_a_field_or_under_a_dialog_or_with_a_modifier_is_not_the_cuts", async () => {
  const { getByTestId, rerender } = render(<Host zone="other" />);
  await settle();
  setCut([p("/d/a")]);
  escape(getByTestId("target"));
  rerender(
    <Host zone="files">
      <input data-testid="field" />
    </Host>
  );
  escape(getByTestId("field"));
  rerender(<Host zone="files" />);
  escape(getByTestId("target"), { shiftKey: true });
  escape(getByTestId("target"), { ctrlKey: true });
  rerender(
    <Host zone="files">
      <div role="dialog" />
    </Host>
  );
  escape(getByTestId("target"));
  await settle();
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
  expect(keys()).toEqual([k("/d/a")]);
});

test("an_escape_another_handler_already_took_is_not_the_cuts", async () => {
  const { getByTestId } = render(<Host zone="files" />);
  await settle();
  setCut([p("/d/a")]);
  getByTestId("target").addEventListener("keydown", (ev) => ev.preventDefault());
  escape(getByTestId("target"));
  await settle();
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
});
