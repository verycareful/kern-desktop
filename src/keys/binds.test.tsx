// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Binds, WireError } from "../ipc";

const ipc = vi.hoisted(() => {
  const handlers: Array<(b: Binds) => void> = [];
  return {
    handlers,
    bindsGet: vi.fn(),
    errorLogAppend: vi.fn(),
    on: vi.fn((name: string, h: (b: Binds) => void) => {
      if (name === "kern://binds-changed") handlers.push(h);
      return Promise.resolve(() => handlers.splice(handlers.indexOf(h), 1));
    }),
  };
});
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import {
  bindLabel,
  bindsOf,
  eventToMouseBind,
  isMouseBind,
  keysOf,
  mouseOf,
  refusedBind,
  useBinds,
  useBindsSync,
} from "./binds";

const none = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const action = { id: "tab.close", keys: ["Ctrl+W", "MiddleClick"] };
const settle = () => act(async () => {});

function Host() {
  useBindsSync();
  return null;
}

beforeEach(() => {
  useBinds.setState({ loaded: false, overrides: {}, error: null });
  ipc.handlers.length = 0;
  ipc.bindsGet.mockReset();
  ipc.errorLogAppend.mockReset().mockResolvedValue(undefined);
  useOps.setState({ notice: null });
});
afterEach(cleanup);

test("a_mouse_bind_is_told_from_a_key_by_its_last_part", () => {
  for (const b of ["Click", "MiddleClick", "RightClick", "MouseBack", "MouseForward"])
    expect(isMouseBind(b), b).toBe(true);
  expect(isMouseBind("Ctrl+Shift+MiddleClick")).toBe(true);
  for (const b of ["Ctrl+W", "ArrowLeft", "Ctrl+ArrowLeft", "F4", "Plus", "Space"])
    expect(isMouseBind(b), b).toBe(false);
});

test("a_mouse_event_is_written_in_the_bind_format_with_modifiers_in_order", () => {
  expect(eventToMouseBind({ ...none, button: 1 })).toBe("MiddleClick");
  expect(eventToMouseBind({ ...none, button: 0, ctrlKey: true })).toBe("Ctrl+Click");
  expect(eventToMouseBind({ ...none, button: 2, shiftKey: true, altKey: true })).toBe(
    "Alt+Shift+RightClick"
  );
  expect(eventToMouseBind({ ...none, button: 3 })).toBe("MouseBack");
  expect(eventToMouseBind({ ...none, button: 4, metaKey: true, ctrlKey: true })).toBe(
    "Ctrl+Meta+MouseForward"
  );
  // A button this table has no name for is no bind.
  expect(eventToMouseBind({ ...none, button: 7 })).toBeNull();
});

test("a_bare_left_or_right_click_cannot_be_a_bind_and_everything_else_can", () => {
  expect(refusedBind("Click")).toMatch(/selects|opens/i);
  expect(refusedBind("RightClick")).toMatch(/menu/i);
  for (const b of ["Ctrl+Click", "Shift+RightClick", "MiddleClick", "MouseBack", "Ctrl+W", "F4"])
    expect(refusedBind(b), b).toBeNull();
});

test("an_action_with_no_override_keeps_its_defaults_and_an_empty_list_unbinds_it", () => {
  expect(bindsOf(action)).toEqual(["Ctrl+W", "MiddleClick"]);
  useBinds.setState({ overrides: { "tab.close": ["F9"] } });
  expect(bindsOf(action)).toEqual(["F9"]);
  useBinds.setState({ overrides: { "tab.close": [] } });
  expect(bindsOf(action)).toEqual([]);
  // Another action's override does not touch this one.
  useBinds.setState({ overrides: { other: ["F1"] } });
  expect(bindsOf(action)).toEqual(["Ctrl+W", "MiddleClick"]);
});

test("the_binds_of_an_action_split_into_keys_and_mouse_and_the_label_prefers_a_key", () => {
  expect(keysOf(action)).toEqual(["Ctrl+W"]);
  expect(mouseOf(action)).toEqual(["MiddleClick"]);
  expect(bindLabel(["MiddleClick", "Ctrl+W"])).toBe("Ctrl+W");
  expect(bindLabel(["MiddleClick"])).toBe("MiddleClick");
  expect(bindLabel([])).toBeUndefined();
});

test("the_store_follows_the_stored_binds_at_start_and_on_every_change_event", async () => {
  ipc.bindsGet.mockResolvedValue({ binds: { a: ["F1"] } });
  render(<Host />);
  await settle();
  expect(useBinds.getState().loaded).toBe(true);
  expect(useBinds.getState().overrides).toEqual({ a: ["F1"] });
  act(() => ipc.handlers[0]!({ binds: { a: ["F2"], b: [] } }));
  expect(useBinds.getState().overrides).toEqual({ a: ["F2"], b: [] });
  // A window that unmounts stops listening.
  cleanup();
  await settle();
  expect(ipc.handlers).toHaveLength(0);
});

test("binds_that_cannot_be_read_are_said_and_logged_and_the_defaults_stay_in_force", async () => {
  const failure: WireError = { kind: "Io", message: "no access", path: null, details: null };
  ipc.bindsGet.mockRejectedValue(failure);
  render(<Host />);
  await settle();
  expect(useBinds.getState().error?.kind).toBe("Io");
  expect(useBinds.getState().overrides).toEqual({});
  expect(bindsOf(action)).toEqual(["Ctrl+W", "MiddleClick"]);
  const said = useOps.getState().notice?.text ?? "";
  expect(said).toMatch(/binds could not be read/i);
  expect(said).toMatch(/no access/);
  expect(ipc.errorLogAppend).toHaveBeenCalledOnce();
});
