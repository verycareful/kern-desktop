// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WireTheme } from "../ipc/kernkraft";

type ThemeHandler = (payload: WireTheme) => void;

const ipc = vi.hoisted(() => ({
  themeGet: vi.fn(),
  settingsGet: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", () => ({
  themeGet: ipc.themeGet,
  settingsGet: ipc.settingsGet,
  on: ipc.on,
  toWireError: (e: unknown) => e,
  EVENT_THEME_CHANGED: "kernkraft://theme-changed",
}));

import { useTheme, type ThemePrefs } from "./useTheme";

const PREFS: ThemePrefs = {
  follow: { colours: true, accent: false, fonts: true, radius: false },
  user: { mode: "dark", accent: "teal", density: "compact" },
};

function theme(css: string, extra: Partial<WireTheme> = {}): WireTheme {
  return { css, tokens: {} as WireTheme["tokens"], fallbacks: [], problems: [], ...extra };
}

const styles = () => document.head.querySelectorAll("style#kern-tokens");

describe("useTheme", () => {
  let handler: ThemeHandler | undefined;
  const unlisten = vi.fn();

  beforeEach(() => {
    handler = undefined;
    ipc.on.mockImplementation((_name: string, h: ThemeHandler) => {
      handler = h;
      return Promise.resolve(unlisten);
    });
  });

  afterEach(async () => {
    // Unmount first: its unlisten calls belong to this test, not the next.
    cleanup();
    await Promise.resolve();
    vi.clearAllMocks();
    document.head.querySelectorAll("style#kern-tokens").forEach((e) => e.remove());
  });

  test("writes_one_style_element", async () => {
    const css = ":root{--kern-bg:#112233ff;}";
    ipc.themeGet.mockResolvedValue(theme(css));
    const { result, rerender } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(result.current.theme?.css).toBe(css));
    rerender();
    expect(styles()).toHaveLength(1);
    expect(styles()[0]?.textContent).toBe(css);
    expect(ipc.themeGet).toHaveBeenCalledWith(PREFS.follow, PREFS.user);
    expect(result.current.error).toBeNull();
  });

  test("rethemes_on_event", async () => {
    ipc.themeGet.mockResolvedValue(theme(":root{--kern-bg:#000000ff;}"));
    const { result } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(handler).toBeDefined());
    await waitFor(() => expect(styles()).toHaveLength(1));
    const first = styles()[0];

    const next = ":root{--kern-bg:#ffffffff;}";
    act(() => handler?.(theme(next)));
    expect(styles()).toHaveLength(1);
    expect(styles()[0]).toBe(first);
    expect(styles()[0]?.textContent).toBe(next);
    expect(result.current.theme?.css).toBe(next);
  });

  test("problems_from_an_earlier_payload_survive_a_later_one", async () => {
    const problem = { kind: "Portal", message: "watcher did not start", path: null, details: null };
    ipc.themeGet.mockResolvedValue(theme(":root{}", { problems: [problem] }));
    const { result } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(result.current.problems).toEqual([problem]));

    act(() => handler?.(theme(":root{--kern-bg:#fff;}")));
    expect(result.current.theme?.css).toBe(":root{--kern-bg:#fff;}");
    expect(result.current.problems).toEqual([problem]);

    // The same problem repeated in a later payload is not listed twice.
    act(() => handler?.(theme(":root{}", { problems: [problem] })));
    expect(result.current.problems).toEqual([problem]);
  });

  test("a_reply_requested_before_an_event_does_not_overwrite_it", async () => {
    let reply: (t: WireTheme) => void = () => undefined;
    ipc.themeGet.mockReturnValue(new Promise<WireTheme>((r) => (reply = r)));
    const { result } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(ipc.themeGet).toHaveBeenCalled());

    const fresh = ":root{--kern-bg:#222222ff;}";
    act(() => handler?.(theme(fresh)));
    const problem = { kind: "Portal", message: "once", path: null, details: null };
    await act(async () => reply(theme(":root{--kern-bg:#111111ff;}", { problems: [problem] })));

    expect(styles()[0]?.textContent).toBe(fresh);
    expect(result.current.theme?.css).toBe(fresh);
    expect(result.current.problems).toEqual([problem]);
  });

  test("unlistens_on_unmount", async () => {
    ipc.themeGet.mockResolvedValue(theme(":root{}"));
    const { unmount } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(ipc.on).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  test("unlistens_when_unmounted_before_the_subscription_resolves", async () => {
    ipc.themeGet.mockResolvedValue(theme(":root{}"));
    let resolve: (u: () => void) => void = () => undefined;
    ipc.on.mockReturnValue(new Promise<() => void>((r) => (resolve = r)));
    const { unmount } = renderHook(() => useTheme(PREFS));
    unmount();
    resolve(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  test("failed_theme_get_is_returned_and_writes_no_style", async () => {
    const failure = { kind: "NoHome", message: "HOME is not set", path: null };
    ipc.themeGet.mockRejectedValue(failure);
    const { result } = renderHook(() => useTheme(PREFS));
    await waitFor(() => expect(result.current.error).toEqual(failure));
    expect(result.current.theme).toBeNull();
    expect(styles()).toHaveLength(0);
  });

  test("reads_the_stored_prefs_when_none_are_given", async () => {
    ipc.settingsGet.mockResolvedValue({
      theme_mode: PREFS.user.mode,
      accent: PREFS.user.accent,
      density: PREFS.user.density,
      follow: PREFS.follow,
    });
    ipc.themeGet.mockResolvedValue(theme(":root{}"));
    renderHook(() => useTheme());
    await waitFor(() => expect(ipc.themeGet).toHaveBeenCalledWith(PREFS.follow, PREFS.user));
  });

  test("failed_settings_get_is_returned", async () => {
    const failure = { kind: "NoHome", message: "no settings dir", path: null };
    ipc.settingsGet.mockRejectedValue(failure);
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.error).toEqual(failure));
    expect(ipc.themeGet).not.toHaveBeenCalled();
  });
});
