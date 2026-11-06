// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CorruptReport } from "../ipc";

const ipc = vi.hoisted(() => ({ on: vi.fn(), storeErrorsTake: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useStoreErrors } from "./store-errors";

const report = (file: string): CorruptReport => ({
  file,
  moved_to: null,
  field: null,
  reason: "x",
});

beforeEach(() => {
  ipc.on.mockResolvedValue(() => undefined);
  useStoreErrors.getState().reset();
});
afterEach(() => vi.clearAllMocks());

test("a_take_asked_for_during_a_take_takes_again_after_it", async () => {
  let first!: (r: CorruptReport[]) => void;
  ipc.storeErrorsTake
    .mockReturnValueOnce(new Promise<CorruptReport[]>((r) => (first = r)))
    .mockResolvedValueOnce([report("pins.json")]);
  const a = useStoreErrors.getState().take();
  const b = useStoreErrors.getState().take();
  first([report("settings.json")]);
  await Promise.all([a, b]);
  expect(ipc.storeErrorsTake).toHaveBeenCalledTimes(2);
  expect(useStoreErrors.getState().reports.map((r) => r.file)).toEqual([
    "settings.json",
    "pins.json",
  ]);
});

test("a_failed_take_is_kept_as_the_error_and_reports_already_taken_stay", async () => {
  ipc.storeErrorsTake
    .mockResolvedValueOnce([report("pins.json")])
    .mockRejectedValueOnce({ kind: "Ipc", message: "gone", path: null, details: null });
  await useStoreErrors.getState().take();
  await useStoreErrors.getState().take();
  expect(useStoreErrors.getState().reports).toHaveLength(1);
  expect(useStoreErrors.getState().error?.message).toBe("gone");
});

test("the_event_is_followed_once_however_many_follow", async () => {
  ipc.storeErrorsTake.mockResolvedValue([]);
  const off = vi.fn();
  ipc.on.mockResolvedValue(off);
  const stopA = await useStoreErrors.getState().follow();
  const stopB = await useStoreErrors.getState().follow();
  expect(ipc.on).toHaveBeenCalledTimes(1);
  stopA();
  expect(off).not.toHaveBeenCalled();
  stopB();
  expect(off).toHaveBeenCalledTimes(1);
});
