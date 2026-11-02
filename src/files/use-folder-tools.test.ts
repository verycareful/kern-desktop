// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WireEntry, WirePath } from "../ipc";
import { dir, entry } from "./test-entries";

const ipc = vi.hoisted(() => ({
  clipText: vi.fn(),
  openTerminal: vi.fn(),
  settingsGet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { useFolderTools } from "./use-folder-tools";

const p = (v: string): WirePath => ({ k: "Utf8", v });
let selection: WireEntry[];

function tools() {
  return renderHook(() =>
    useFolderTools({ folder: p("/d"), listed: () => true, selected: () => selection })
  );
}

beforeEach(() => {
  selection = [];
  ipc.clipText.mockResolvedValue(undefined);
  ipc.openTerminal.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue({ terminal: "kitty" } as Settings);
});
afterEach(() => vi.clearAllMocks());

test("copy_path_copies_the_selection_one_per_line", async () => {
  selection = [entry("a.txt"), entry("b c.md")];
  const { result } = tools();
  act(() => result.current.copyPath());
  expect(ipc.clipText).toHaveBeenCalledExactlyOnceWith("/d/a.txt\n/d/b c.md");
  await waitFor(() => expect(useOps.getState().notice?.text).toBe("Copied the path of 2 items"));
});

test("copy_path_with_nothing_selected_copies_the_folder", () => {
  const { result } = tools();
  act(() => result.current.copyPath());
  expect(ipc.clipText).toHaveBeenCalledExactlyOnceWith("/d");
});

test("a_path_that_is_not_utf8_is_not_copied", () => {
  selection = [entry("a.txt"), { ...entry("x"), path: { k: "Bytes", v: btoa("/d/\xff") } }];
  const { result } = tools();
  act(() => result.current.copyPath());
  expect(ipc.clipText).not.toHaveBeenCalled();
  expect(result.current.notes[0]).toMatch(
    /^The path was not copied: the name of .* is not valid UTF-8/
  );
});

test("the_terminal_opens_in_the_one_selected_folder_else_the_folder_on_show", async () => {
  selection = [dir("sub")];
  const { result } = tools();
  act(() => result.current.openTerminalHere());
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledWith(p("/d/sub"), "kitty"));
  selection = [entry("a.txt")];
  act(() => result.current.openTerminalHere());
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenLastCalledWith(p("/d"), "kitty"));
});

test("terminal_error_lists_tried", async () => {
  ipc.settingsGet.mockResolvedValue({ terminal: null } as Settings);
  const message =
    "no terminal found; tried xdg-terminal-exec (not found on PATH), $TERMINAL (not set), setting (not set)";
  ipc.openTerminal.mockRejectedValue({ kind: "NoTerminal", message, path: null, details: null });
  const { result } = tools();
  act(() => result.current.openTerminalHere());
  await waitFor(() => expect(result.current.notes).toHaveLength(1));
  expect(ipc.openTerminal).toHaveBeenCalledWith(p("/d"), undefined);
  for (const tried of [
    "xdg-terminal-exec (not found on PATH)",
    "$TERMINAL (not set)",
    "setting (not set)",
  ]) {
    expect(result.current.notes[0]).toContain(tried);
  }
});

test("open_with_needs_exactly_one_file", () => {
  const { result } = tools();
  expect(result.current.canOpenWith()).toBe(false);
  selection = [dir("sub")];
  expect(result.current.canOpenWith()).toBe(false);
  selection = [entry("a.txt"), entry("b.txt")];
  expect(result.current.canOpenWith()).toBe(false);
  selection = [entry("a.txt")];
  expect(result.current.canOpenWith()).toBe(true);
  act(() => result.current.openWith());
  expect(result.current.choosing?.name).toBe("a.txt");
});
