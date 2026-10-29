// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ clipClearIf: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { clearSpentCut, forgetSpentCuts } from "./spent-cut";
import { useOps } from "./useOps";

// A cut that was pasted and fully moved is taken off the clipboard (design 5.8). Clearing needs
// the window to have the focus, so a move that ended while Kern was in the background is cleared
// when the window gets the focus back; it is not an error.

const p = (v: string): WirePath => ({ k: "Utf8", v });
const err = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});
const cut = [p("/o/x"), p("/o/y")];
const focus = () => window.dispatchEvent(new Event("focus"));
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  forgetSpentCuts();
  useOps.getState().reset();
  ipc.clipClearIf.mockResolvedValue(true);
});
afterEach(() => {
  forgetSpentCuts();
  vi.clearAllMocks();
});

test("a_spent_cut_is_cleared_at_once_when_the_window_has_the_focus", async () => {
  await clearSpentCut(cut);
  expect(ipc.clipClearIf).toHaveBeenCalledExactlyOnceWith("cut", cut);
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(1);
});

test("without_the_focus_it_waits_silently_and_clears_when_the_focus_comes_back", async () => {
  ipc.clipClearIf.mockRejectedValueOnce(err("NoFocus"));
  await clearSpentCut(cut);
  expect(useOps.getState().reports).toEqual([]);
  expect(useOps.getState().notice).toBeNull();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(1);
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(2);
  expect(ipc.clipClearIf).toHaveBeenLastCalledWith("cut", cut);
  expect(useOps.getState().reports).toEqual([]);
  // Done: a later focus does nothing more.
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(2);
});

test("a_retry_that_still_has_no_focus_says_plainly_the_cut_is_still_on_the_clipboard_and_waits_again", async () => {
  ipc.clipClearIf.mockRejectedValue(err("NoFocus"));
  await clearSpentCut(cut);
  focus();
  await settle();
  expect(useOps.getState().notice?.text).toMatch(/cut is still on the clipboard/i);
  expect(useOps.getState().reports).toEqual([]);
  ipc.clipClearIf.mockResolvedValue(true);
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(3);
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(3);
});

test("a_clipboard_that_no_longer_holds_the_cut_ends_the_wait_without_a_word", async () => {
  ipc.clipClearIf.mockRejectedValueOnce(err("NoFocus"));
  await clearSpentCut(cut);
  ipc.clipClearIf.mockResolvedValue(false);
  focus();
  await settle();
  expect(useOps.getState().reports).toEqual([]);
  expect(useOps.getState().notice).toBeNull();
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(2);
});

test("any_other_failure_is_a_report_and_is_not_retried", async () => {
  ipc.clipClearIf.mockRejectedValue(err("Clipboard", "the owner did not answer"));
  await clearSpentCut(cut);
  const [shown] = useOps.getState().reports;
  expect(shown!.outcome.title).toMatch(/clipboard/i);
  expect(shown!.outcome.error).toMatchObject({ kind: "Clipboard" });
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(1);
});

test("a_failure_of_the_retry_other_than_no_focus_is_a_report_too", async () => {
  ipc.clipClearIf.mockRejectedValueOnce(err("NoFocus"));
  await clearSpentCut(cut);
  ipc.clipClearIf.mockRejectedValue(err("Timeout", "no answer in 5 s"));
  focus();
  await settle();
  expect(useOps.getState().reports).toHaveLength(1);
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "Timeout" });
});

test("several_cuts_waiting_are_each_retried_on_one_focus", async () => {
  ipc.clipClearIf.mockRejectedValue(err("NoFocus"));
  await clearSpentCut(cut);
  await clearSpentCut([p("/o/z")]);
  ipc.clipClearIf.mockResolvedValue(true);
  ipc.clipClearIf.mockClear();
  focus();
  await settle();
  expect(ipc.clipClearIf).toHaveBeenCalledTimes(2);
  expect(ipc.clipClearIf).toHaveBeenCalledWith("cut", cut);
  expect(ipc.clipClearIf).toHaveBeenCalledWith("cut", [p("/o/z")]);
});
