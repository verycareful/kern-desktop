// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ThumbEvent, WirePath } from "../ipc";
import { entry } from "./test-entries";

type Handler = (payload: ThumbEvent) => void;

const ipc = vi.hoisted(() => ({
  thumbRequest: vi.fn(),
  thumbCancel: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async () => {
  const real = await vi.importActual<typeof import("../ipc/wire-path")>("../ipc/wire-path");
  return {
    ...real,
    thumbRequest: ipc.thumbRequest,
    thumbCancel: ipc.thumbCancel,
    on: ipc.on,
    toWireError: (e: unknown) => e,
    assetUrl: (f: WirePath) => `asset://${f.v}`,
    EVENT_THUMB: "kernkraft://thumb",
  };
});

import { thumbSizeFor, useThumbnails } from "./useThumbnails";

const img = (n: string) => entry(n, { mime: "image/png" });
const p = (v: string): WirePath => ({ k: "Utf8", v });

let handler: Handler | undefined;
const unlisten = vi.fn();

beforeEach(() => {
  handler = undefined;
  ipc.on.mockImplementation((_n: string, h: Handler) => {
    handler = h;
    return Promise.resolve(unlisten);
  });
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.clearAllMocks();
});

const requested = () =>
  ipc.thumbRequest.mock.calls.map((c) => (c[1] as WirePath[]).map((x) => x.v));

test("sizes_follow_the_pixel_ratio", () => {
  // Cache sizes are 128 and 256 px (Thumbnail Managing Standard); the grid shows
  // images at most 128 CSS px wide, so 1x screens take normal and denser ones large.
  expect(thumbSizeFor(1)).toBe("normal");
  expect(thumbSizeFor(1.25)).toBe("large");
  expect(thumbSizeFor(2)).toBe("large");
});

test("requests_only_the_visible_images", async () => {
  const visible = [img("a.png"), entry("b.txt", { mime: "text/plain" }), img("c.png")];
  const { result } = renderHook(() => useThumbnails("t1", visible, "normal"));
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalled());
  expect(requested()).toEqual([["/d/a.png", "/d/c.png"]]);
  expect(ipc.thumbRequest.mock.calls[0]![0]).toBe("t1");
  expect(ipc.thumbRequest.mock.calls[0]![2]).toBe("normal");
  expect(result.current.size).toBe(0);
});

test("a_thumb_event_gives_the_url", async () => {
  const visible = [img("a.png")];
  const { result } = renderHook(() => useThumbnails("t1", visible, "normal"));
  await waitFor(() => expect(handler).toBeDefined());
  act(() => handler!({ key: "t1", path: p("/d/a.png"), file: p("/c/x.png"), error: null }));
  expect(result.current.get("Utf8:/d/a.png")).toEqual({ state: "ready", url: "asset:///c/x.png" });
  // Another key is not ours.
  act(() => handler!({ key: "t2", path: p("/d/b.png"), file: p("/c/y.png"), error: null }));
  expect(result.current.size).toBe(1);
});

test("no_thumbnail_and_errors_are_recorded_not_retried", async () => {
  const visible = [img("a.png"), img("b.png")];
  const err = { kind: "Io", message: "unreadable", path: null, details: null };
  const { result, rerender } = renderHook(({ v }) => useThumbnails("t1", v, "normal"), {
    initialProps: { v: visible },
  });
  await waitFor(() => expect(handler).toBeDefined());
  act(() => handler!({ key: "t1", path: p("/d/a.png"), file: null, error: null }));
  act(() => handler!({ key: "t1", path: p("/d/b.png"), file: null, error: err }));
  expect(result.current.get("Utf8:/d/a.png")).toEqual({ state: "none" });
  expect(result.current.get("Utf8:/d/b.png")).toEqual({ state: "error", error: err });
  ipc.thumbRequest.mockClear();
  rerender({ v: [...visible] });
  await Promise.resolve();
  expect(ipc.thumbRequest).not.toHaveBeenCalled();
});

test("scrolling_requests_new_items_and_cancels_the_ones_left_behind", async () => {
  const first = [img("a.png"), img("b.png")];
  const { rerender } = renderHook(({ v }) => useThumbnails("t1", v, "normal"), {
    initialProps: { v: first },
  });
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(1));
  // b stays visible, a leaves, c arrives; none of them has resolved yet.
  rerender({ v: [img("b.png"), img("c.png")] });
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(2));
  expect(ipc.thumbCancel).toHaveBeenCalledWith("t1");
  expect(requested()[1]).toEqual(["/d/b.png", "/d/c.png"]);
});

test("new_items_alone_do_not_cancel", async () => {
  const { rerender } = renderHook(({ v }) => useThumbnails("t1", v, "normal"), {
    initialProps: { v: [img("a.png")] },
  });
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(1));
  rerender({ v: [img("a.png"), img("b.png")] });
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(2));
  expect(ipc.thumbCancel).not.toHaveBeenCalled();
  expect(requested()[1]).toEqual(["/d/b.png"]);
});

test("a_new_key_cancels_the_old_one_and_forgets_its_thumbnails", async () => {
  const visible = [img("a.png")];
  const { result, rerender } = renderHook(({ k }) => useThumbnails(k, visible, "normal"), {
    initialProps: { k: "t1" },
  });
  await waitFor(() => expect(handler).toBeDefined());
  act(() => handler!({ key: "t1", path: p("/d/a.png"), file: p("/c/x.png"), error: null }));
  rerender({ k: "t2" });
  await waitFor(() => expect(ipc.thumbCancel).toHaveBeenCalledWith("t1"));
  expect(result.current.size).toBe(0);
  await waitFor(() =>
    expect(ipc.thumbRequest).toHaveBeenLastCalledWith("t2", [p("/d/a.png")], "normal")
  );
});

test("unmount_cancels_and_stops_listening", async () => {
  const { unmount } = renderHook(() => useThumbnails("t1", [img("a.png")], "normal"));
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalled());
  unmount();
  expect(ipc.thumbCancel).toHaveBeenCalledWith("t1");
  await waitFor(() => expect(unlisten).toHaveBeenCalled());
});

test("a_failed_request_is_reported_per_item", async () => {
  const err = { kind: "Io", message: "no queue", path: null, details: null };
  ipc.thumbRequest.mockRejectedValue(err);
  const { result } = renderHook(() => useThumbnails("t1", [img("a.png")], "normal"));
  await waitFor(() =>
    expect(result.current.get("Utf8:/d/a.png")).toEqual({ state: "error", error: err })
  );
});
