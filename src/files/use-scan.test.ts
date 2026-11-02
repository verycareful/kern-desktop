// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpId } from "../ipc";
import { entry } from "./test-entries";

const ipc = vi.hoisted(() => ({ on: vi.fn(), cancelOp: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useScan } from "./use-scan";

let handlers: Record<string, ((payload: unknown) => void)[]>;
const offs: string[] = [];

beforeEach(() => {
  handlers = {};
  offs.length = 0;
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => {
      offs.push(name);
      handlers[name] = (handlers[name] ?? []).filter((x) => x !== h);
    });
  });
  ipc.cancelOp.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

test("a_stop_while_the_subscription_is_pending_starts_nothing", async () => {
  let subscribed!: (off: () => void) => void;
  ipc.on.mockImplementationOnce(() => new Promise((r) => (subscribed = r)));
  const begin = vi.fn(() => Promise.resolve(1 as OpId));
  const { result } = renderHook(() => useScan());
  act(() => result.current.start(begin));
  act(() => result.current.stop());
  const off = vi.fn();
  await act(async () => subscribed(off));
  expect(begin).not.toHaveBeenCalled();
  // The subscription made after the stop is let go at once.
  expect(off).toHaveBeenCalledTimes(1);
  expect(result.current.phase).toBe("idle");
});

test("a_superseded_run_that_fails_to_start_changes_nothing", async () => {
  let refuse!: (e: unknown) => void;
  const first = vi.fn(() => new Promise<OpId>((_, rej) => (refuse = rej)));
  const second = vi.fn(() => Promise.resolve(2 as OpId));
  const { result } = renderHook(() => useScan());
  act(() => result.current.start(first));
  await waitFor(() => expect(first).toHaveBeenCalled());
  act(() => result.current.start(second));
  await waitFor(() => expect(second).toHaveBeenCalled());
  await act(async () => refuse({ kind: "Io", message: "late", path: null, details: null }));
  expect(result.current.phase).toBe("running");
  expect(result.current.error).toBeNull();
});

test("the_hit_listener_is_let_go_when_the_walk_ends", async () => {
  const { result } = renderHook(() => useScan());
  act(() => result.current.start(() => Promise.resolve(3 as OpId)));
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBe(1));
  act(() => handlers["kernkraft://search-hit"]![0]!({ key: "nope", op: 3, entries: [entry("x")] }));
  expect(result.current.count).toBe(0);
  act(() =>
    handlers["kernkraft://op-done"]![0]!({
      op: 3,
      report: null,
      properties: null,
      error: null,
      scan: { found: 0, unreadable: [], cancelled: false },
    })
  );
  await waitFor(() => expect(result.current.phase).toBe("done"));
  expect(offs).toContain("kernkraft://search-hit");
});
