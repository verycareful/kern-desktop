// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The windows of the last run are offered at the top of the main window when there are some;
// Restore opens them, the close button forgets them, and a failure is said.

const ipc = vi.hoisted(() => ({
  sessionClosedGet: vi.fn(),
  sessionRestoreClosed: vi.fn(),
  sessionClosedDismiss: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { RestoreBar } from "./RestoreBar";

const failure = { kind: "Io", message: "disk gone", path: null, details: null };

beforeEach(() => {
  ipc.sessionRestoreClosed.mockResolvedValue(undefined);
  ipc.sessionClosedDismiss.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("with_no_windows_from_last_time_nothing_is_shown", async () => {
  ipc.sessionClosedGet.mockResolvedValue(0);
  const { container } = render(<RestoreBar />);
  await waitFor(() => expect(ipc.sessionClosedGet).toHaveBeenCalled());
  await Promise.resolve();
  expect(container).toBeEmptyDOMElement();
});

test("the_count_is_offered_and_restore_opens_them_and_the_bar_goes", async () => {
  ipc.sessionClosedGet.mockResolvedValue(3);
  render(<RestoreBar />);
  const bar = await screen.findByRole("region", { name: "Windows from last time" });
  expect(bar).toHaveTextContent("3 windows from last time.");
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  expect(ipc.sessionRestoreClosed).toHaveBeenCalledTimes(1);
  expect(ipc.sessionClosedDismiss).not.toHaveBeenCalled();
});

test("one_window_is_said_as_one_and_the_close_button_forgets_it", async () => {
  ipc.sessionClosedGet.mockResolvedValue(1);
  render(<RestoreBar />);
  expect(await screen.findByRole("region")).toHaveTextContent("1 window from last time.");
  fireEvent.click(screen.getByRole("button", { name: "Forget the windows from last time" }));
  await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  expect(ipc.sessionClosedDismiss).toHaveBeenCalledTimes(1);
  expect(ipc.sessionRestoreClosed).not.toHaveBeenCalled();
});

test("a_restore_that_fails_is_said_and_can_be_tried_again", async () => {
  ipc.sessionClosedGet.mockResolvedValue(2);
  ipc.sessionRestoreClosed.mockRejectedValueOnce(failure);
  render(<RestoreBar />);
  await screen.findByRole("region");
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("disk gone");
  expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
});

test("a_lookup_that_fails_is_said_and_can_be_dismissed", async () => {
  ipc.sessionClosedGet.mockRejectedValue(failure);
  render(<RestoreBar />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /windows from last time could not be looked up.*disk gone/
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
