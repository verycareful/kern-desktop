// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ pdfJobProgress: vi.fn(), pdfCancelJob: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { progressText, startJob, whyNotTheFile } from "./page-files";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ipc.pdfCancelJob.mockResolvedValue(undefined);
  ipc.pdfJobProgress.mockResolvedValue({ running: true, done: 0, total: 0, stage: "" });
});
afterEach(() => vi.useRealTimers());

test("the_job_has_a_number_the_call_and_the_poll_share", async () => {
  let given = 0;
  const job = startJob(
    (n) => {
      given = n;
      return Promise.resolve("done");
    },
    () => undefined
  );
  expect(job.job).toBe(given);
  await expect(job.result).resolves.toBe("done");
});

test("progress_is_polled_while_the_call_runs_and_stops_when_it_ends", async () => {
  let finish!: (v: string) => void;
  const seen: unknown[] = [];
  const job = startJob(
    () => new Promise<string>((r) => (finish = r)),
    (p) => seen.push(p),
    { intervalMs: 100 }
  );
  ipc.pdfJobProgress.mockResolvedValue({ running: true, done: 1, total: 4, stage: "Merging" });
  await vi.advanceTimersByTimeAsync(100);
  expect(ipc.pdfJobProgress).toHaveBeenCalledWith(job.job);
  expect(seen[seen.length - 1]).toEqual({ done: 1, total: 4, stage: "Merging" });
  finish("ok");
  await job.result;
  const polls = ipc.pdfJobProgress.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(ipc.pdfJobProgress.mock.calls.length).toBe(polls);
});

test("a_poll_that_fails_is_ignored_and_the_call_goes_on", async () => {
  let finish!: (v: string) => void;
  const job = startJob(
    () => new Promise<string>((r) => (finish = r)),
    () => undefined,
    { intervalMs: 100 }
  );
  ipc.pdfJobProgress.mockRejectedValue(new Error("gone"));
  await vi.advanceTimersByTimeAsync(300);
  finish("ok");
  await expect(job.result).resolves.toBe("ok");
});

test("a_job_that_is_not_running_yet_reports_nothing", async () => {
  const seen: unknown[] = [];
  let finish!: (v: string) => void;
  const job = startJob(
    () => new Promise<string>((r) => (finish = r)),
    (p) => seen.push(p),
    { intervalMs: 100 }
  );
  ipc.pdfJobProgress.mockResolvedValue({ running: false, done: 0, total: 0, stage: "" });
  await vi.advanceTimersByTimeAsync(100);
  expect(seen).toEqual([]);
  finish("ok");
  await job.result;
});

test("cancel_asks_the_engine_to_stop_this_job", async () => {
  const job = startJob(
    () => new Promise<string>(() => undefined),
    () => undefined
  );
  await job.cancel();
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job.job);
});

test("a_failed_cancel_is_not_thrown", async () => {
  ipc.pdfCancelJob.mockRejectedValue(new Error("no"));
  const job = startJob(
    () => new Promise<string>(() => undefined),
    () => undefined
  );
  await expect(job.cancel()).resolves.toBeUndefined();
});

test("a_failure_of_the_call_is_the_failure_of_the_result", async () => {
  const job = startJob(
    () => Promise.reject(new Error("exists")),
    () => undefined
  );
  await expect(job.result).rejects.toThrow("exists");
});

test("progress_text_says_how_far_when_the_total_is_known", () => {
  expect(progressText({ done: 2, total: 5, stage: "Merging" })).toBe("Merging 2 of 5");
  expect(progressText({ done: 2, total: 0, stage: "Writing" })).toBe("Writing…");
  expect(progressText({ done: 0, total: 0, stage: "" })).toBe("Working…");
  expect(progressText({ done: 2, total: 5, stage: "" })).toBe("Working 2 of 5");
});

test("a_change_not_saved_is_not_in_the_file_so_the_work_is_refused_with_the_reason", () => {
  expect(whyNotTheFile({ modified: false, externalChange: "none" })).toBeNull();
  expect(whyNotTheFile({ modified: true, externalChange: "none" })).toMatch(
    /changes that are not saved/
  );
  expect(whyNotTheFile({ modified: false, externalChange: "changed" })).toMatch(
    /changed by another program/
  );
  expect(whyNotTheFile({ modified: false, externalChange: "gone" })).toMatch(
    /no longer on the disk/
  );
});
