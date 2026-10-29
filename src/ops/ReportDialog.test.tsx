// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { WireError, WireItemError, WirePath, WireReport } from "../ipc";
import { REPORT_PAGE as PAGE } from "./outcome";
import { ReportDialog } from "./ReportDialog";
import { useOps } from "./useOps";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const err = (kind: string, message: string, details: WireError["details"] = null): WireError => ({
  kind,
  message,
  path: null,
  details,
});
const item = (v: string, kind = "Io", message = "no"): WireItemError => ({
  path: p(v),
  error: err(kind, message),
});
const report = (over: Partial<WireReport> = {}): WireReport => ({
  done: [],
  skipped: [],
  failed: [],
  warnings: [],
  cancelled: false,
  not_reached: [],
  ...over,
});

beforeEach(() => useOps.getState().reset());
afterEach(cleanup);

test("nothing_is_shown_without_a_report", () => {
  render(<ReportDialog />);
  expect(screen.queryByTestId("report-dialog")).toBeNull();
});

test("every_skipped_failed_warned_and_unreached_item_is_listed_with_its_reason", () => {
  useOps.getState().report({
    title: "Copy of 6 items to /b",
    error: null,
    report: report({
      done: [{ source: p("/a/ok"), dest: p("/b/ok") }],
      skipped: [p("/a/s1"), p("/a/s2")],
      failed: [
        item("/a/f1", "PermissionDenied", "cannot read f1"),
        item("/a/f2", "Io", "disk full"),
      ],
      warnings: [item("/a/w1", "XattrsNotKept", "xattrs not kept")],
      cancelled: true,
      not_reached: [p("/a/n1")],
    }),
  });
  render(<ReportDialog />);
  const dialog = screen.getByTestId("report-dialog");
  expect(dialog).toHaveTextContent("Copy of 6 items to /b");
  expect(dialog).toHaveTextContent(
    "1 done, 2 skipped, 2 failed, 1 warning, cancelled, 1 not reached."
  );
  const failed = within(dialog).getAllByTestId("report-item");
  // Failed items come first, then warnings, each with the reason.
  expect(failed.map((f) => f.textContent)).toEqual([
    "/a/f1 PermissionDenied: cannot read f1",
    "/a/f2 Io: disk full",
    "/a/w1 XattrsNotKept: xattrs not kept",
  ]);
  expect(
    within(dialog)
      .getAllByTestId("report-skipped")
      .map((f) => f.textContent)
  ).toEqual(["/a/s1", "/a/s2"]);
  expect(
    within(dialog)
      .getAllByTestId("report-not-reached")
      .map((f) => f.textContent)
  ).toEqual(["/a/n1"]);
});

test("the_done_items_are_listed_once_the_section_is_opened", () => {
  useOps.getState().report({
    title: "t",
    error: null,
    report: report({
      done: [{ source: p("/a/ok"), dest: p("/b/ok") }],
      skipped: [p("/a/s")],
    }),
  });
  render(<ReportDialog />);
  expect(screen.queryByTestId("report-done")).toBeNull();
  const details = screen.getByText(/Done \(1\)/).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByTestId("report-done")).toHaveTextContent("/a/ok → /b/ok");
});

test("a_long_list_is_shown_a_page_at_a_time_and_every_item_is_one_click_away", () => {
  const failed = Array.from({ length: PAGE + 50 }, (_, i) => item(`/a/f${i}`));
  useOps.getState().report({ title: "t", error: null, report: report({ failed }) });
  render(<ReportDialog />);
  expect(screen.getAllByTestId("report-item")).toHaveLength(PAGE);
  fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
  expect(screen.getAllByTestId("report-item")).toHaveLength(PAGE + 50);
  const rows = screen.getAllByTestId("report-item");
  expect(rows[rows.length - 1]).toHaveTextContent(`/a/f${PAGE + 49}`);
  expect(screen.queryByRole("button", { name: /show/i })).toBeNull();
});

test("show_all_lists_the_whole_report", () => {
  const skipped = Array.from({ length: 3 * PAGE }, (_, i) => p(`/a/s${i}`));
  useOps.getState().report({ title: "t", error: null, report: report({ skipped }) });
  render(<ReportDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Show all 600" }));
  expect(screen.getAllByTestId("report-skipped")).toHaveLength(3 * PAGE);
});

test("a_path_that_is_not_utf8_is_shown_with_replacement_characters", () => {
  const raw: WirePath = { k: "Bytes", v: btoa("/a/bad\xff.txt") };
  useOps.getState().report({ title: "t", error: null, report: report({ skipped: [raw] }) });
  render(<ReportDialog />);
  expect(screen.getByTestId("report-skipped")).toHaveTextContent("/a/bad\ufffd.txt");
});

test("an_operation_that_did_not_run_says_why", () => {
  useOps
    .getState()
    .report({ title: "Delete x", report: null, error: err("Busy", "busy: an undo is running") });
  render(<ReportDialog />);
  expect(screen.getByTestId("report-dialog")).toHaveTextContent(
    "It did not run: Busy: busy: an undo is running"
  );
});

test("an_undo_that_stopped_partway_lists_what_was_and_was_not_undone", () => {
  useOps.getState().report({
    title: "Undo trash of 2 items",
    report: null,
    error: err("Partial", "stopped after 1 of 2 items", {
      k: "Partial",
      done: [p("/d/a")],
      not_done: [p("/d/b")],
      cause: err("Changed", "/d/b is gone"),
      warnings: [item("/d/a", "XattrsNotKept", "x")],
    }),
  });
  render(<ReportDialog />);
  const dialog = screen.getByTestId("report-dialog");
  expect(dialog).toHaveTextContent("It stopped partway");
  expect(
    within(dialog)
      .getAllByTestId("report-done")
      .map((e) => e.textContent)
  ).toEqual(["/d/a"]);
  expect(
    within(dialog)
      .getAllByTestId("report-not-reached")
      .map((e) => e.textContent)
  ).toEqual(["/d/b"]);
  expect(dialog).toHaveTextContent("Changed: /d/b is gone");
  expect(within(dialog).getAllByTestId("report-item")).toHaveLength(1);
});

test("reports_queue_and_closing_one_shows_the_next", () => {
  useOps.getState().report({ title: "First", report: null, error: err("Io", "a") });
  useOps.getState().report({ title: "Second", report: null, error: err("Io", "b") });
  render(<ReportDialog />);
  const dialog = () => screen.getByTestId("report-dialog");
  expect(dialog()).toHaveTextContent("First");
  expect(dialog()).toHaveTextContent("One more report follows.");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(dialog()).toHaveTextContent("Second");
  expect(dialog()).not.toHaveTextContent("more report");
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Escape" });
  expect(screen.queryByTestId("report-dialog")).toBeNull();
  expect(useOps.getState().reports).toEqual([]);
});
