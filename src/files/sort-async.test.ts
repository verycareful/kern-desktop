// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test, vi } from "vitest";
import { entry } from "./test-entries";
import { SORT_IN_WORKER_ABOVE, createSorter } from "./sort-async";
import { sortEntries } from "./sort";
import { sortPermutation, type SortInput, type SortBy, type SortDir } from "./sort-core";

type Message = { id: number; input: SortInput; by: SortBy; dir: SortDir; locale?: string };

// A worker that runs the real sort code on the other side of postMessage.
class FakeWorker {
  static made: FakeWorker[] = [];
  static mode: "ok" | "crash" | "hold" = "ok";
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  held: Message[] = [];
  listeners: Record<string, ((e: never) => void)[]> = {};
  constructor() {
    FakeWorker.made.push(this);
  }
  addEventListener(name: string, fn: (e: never) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  postMessage(msg: Message) {
    if (FakeWorker.mode === "crash") {
      queueMicrotask(() => this.listeners.error?.forEach((f) => f({ message: "boom" } as never)));
      return;
    }
    if (FakeWorker.mode === "hold") {
      this.held.push(msg);
      return;
    }
    this.reply(msg);
  }
  reply(msg: Message) {
    const perm = sortPermutation(msg.input, msg.by, msg.dir, msg.locale);
    queueMicrotask(() =>
      this.listeners.message?.forEach((f) => f({ data: { id: msg.id, perm } } as never))
    );
  }
  terminate() {
    this.terminated = true;
  }
}

const big = (n: number) =>
  Array.from({ length: n }, (_, i) => entry(`\u00e9${(i * 7919) % n}.txt`, { len: i % 13 }));

afterEach(() => {
  FakeWorker.made = [];
  FakeWorker.mode = "ok";
});

const make = () => createSorter(() => new FakeWorker() as unknown as Worker);

test("at_or_below_the_limit_the_sort_is_synchronous_and_needs_no_worker", async () => {
  expect(SORT_IN_WORKER_ABOVE).toBe(5000);
  const sorter = make();
  const list = big(SORT_IN_WORKER_ABOVE);
  const out = await sorter.sort(list, "name", "asc");
  expect(out.map((e) => e.name)).toEqual(sortEntries(list, "name", "asc").map((e) => e.name));
  expect(FakeWorker.made).toHaveLength(0);
});

test("above_the_limit_the_worker_sorts_and_the_result_equals_the_synchronous_sort", async () => {
  const sorter = make();
  const list = big(SORT_IN_WORKER_ABOVE + 1);
  for (const by of ["name", "size", "modified", "type"] as const) {
    const out = await sorter.sort(list, by, "desc");
    expect(
      out.map((e) => e.path.v),
      by
    ).toEqual(sortEntries(list, by, "desc").map((e) => e.path.v));
  }
  // One worker serves every request.
  expect(FakeWorker.made).toHaveLength(1);
});

test("requests_are_matched_by_id_whatever_order_the_answers_come_in", async () => {
  FakeWorker.mode = "hold";
  const sorter = make();
  const list = big(SORT_IN_WORKER_ABOVE + 1);
  const first = sorter.sort(list, "name", "asc");
  const second = sorter.sort(list, "name", "desc");
  const w = FakeWorker.made[0]!;
  expect(w.held).toHaveLength(2);
  w.reply(w.held[1]!);
  w.reply(w.held[0]!);
  const [a, b] = await Promise.all([first, second]);
  expect(a[0]!.name).not.toBe(b[0]!.name);
  expect(a.map((e) => e.name)).toEqual(sortEntries(list, "name", "asc").map((e) => e.name));
  expect(b.map((e) => e.name)).toEqual(sortEntries(list, "name", "desc").map((e) => e.name));
});

test("a_worker_error_rejects_every_waiting_request_with_a_wire_error", async () => {
  FakeWorker.mode = "crash";
  const sorter = make();
  const list = big(SORT_IN_WORKER_ABOVE + 1);
  const a = sorter.sort(list, "name", "asc");
  const b = sorter.sort(list, "size", "asc");
  await expect(a).rejects.toMatchObject({ kind: "Sort", message: expect.stringContaining("boom") });
  await expect(b).rejects.toMatchObject({ kind: "Sort" });
  expect(FakeWorker.made[0]!.terminated).toBe(true);
  // The next request starts a fresh worker.
  FakeWorker.mode = "ok";
  const out = await sorter.sort(list, "name", "asc");
  expect(out).toHaveLength(list.length);
  expect(FakeWorker.made).toHaveLength(2);
});

test("dispose_terminates_the_worker_and_rejects_what_was_waiting", async () => {
  FakeWorker.mode = "hold";
  const sorter = make();
  const pending = sorter.sort(big(SORT_IN_WORKER_ABOVE + 1), "name", "asc");
  const settled = vi.fn();
  pending.then(settled, settled);
  sorter.dispose();
  expect(FakeWorker.made[0]!.terminated).toBe(true);
  await expect(pending).rejects.toMatchObject({ kind: "Sort" });
});
