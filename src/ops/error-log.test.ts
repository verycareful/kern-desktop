// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireError } from "../ipc";

// What a window shows as an error is also sent to the backend's error log; a line the log cannot
// keep is said on the console, since nothing else shows it.

const ipc = vi.hoisted(() => ({ errorLogAppend: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { logError } from "./error-log";
import { showOpenErrors, useOpenError } from "./open-error-store";

const noApp: WireError = {
  kind: "NoApplication",
  message: "no application opens this file",
  path: null,
  details: null,
};

beforeEach(() => {
  ipc.errorLogAppend.mockReset();
  ipc.errorLogAppend.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  useOpenError.getState().dismiss();
});

test("a_line_goes_to_the_log_with_its_source", () => {
  logError("tree", "a.txt: gone");
  expect(ipc.errorLogAppend).toHaveBeenCalledExactlyOnceWith("tree", "a.txt: gone");
});

test("a_line_the_log_cannot_keep_is_said_on_the_console_with_the_reason", async () => {
  const say = vi.spyOn(console, "error").mockImplementation(() => undefined);
  ipc.errorLogAppend.mockRejectedValue({
    kind: "LogWrite",
    message: "/state/kern.log: disk full",
    path: null,
    details: null,
  });
  logError("open", "x was not opened");
  await vi.waitFor(() => expect(say).toHaveBeenCalledTimes(1));
  const text = String(say.mock.calls[0]![0]);
  expect(text).toContain("[open] x was not opened");
  expect(text).toContain("LogWrite: /state/kern.log: disk full");
});

test("each_failed_open_is_logged_as_the_line_the_user_sees", () => {
  showOpenErrors("a.xyz", [noApp, { ...noApp, kind: "NotFound", message: "gone" }]);
  expect(useOpenError.getState().lines).toEqual([
    "a.xyz was not opened: NoApplication: no application opens this file",
    "a.xyz was not opened: NotFound: gone",
  ]);
  expect(ipc.errorLogAppend.mock.calls).toEqual([
    ["open", "a.xyz was not opened: NoApplication: no application opens this file"],
    ["open", "a.xyz was not opened: NotFound: gone"],
  ]);
});

test("an_open_that_succeeds_logs_nothing", () => {
  showOpenErrors("a.txt", []);
  expect(ipc.errorLogAppend).not.toHaveBeenCalled();
});
