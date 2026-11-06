// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { actions, findDuplicateBindings } from "../keys/actions";
import { KEYS } from "./editor-keys";

// CodeMirror spells Ctrl as "Ctrl" and "Mod" (Ctrl on Linux and Windows, Cmd on a Mac); `mac`,
// `linux` and `win` give a platform its own key.
const LINUX_KEYS = (): string[] =>
  KEYS.flatMap((k) => [k.key, k.linux].filter((x): x is string => typeof x === "string"));

test("ctrl_b_is_not_bound_by_the_editors_keymaps_on_linux", () => {
  const taken = LINUX_KEYS().flatMap((k) => k.split(/\s+/));
  expect(taken).not.toContain("Mod-b");
  expect(taken).not.toContain("Ctrl-b");
  // The emacs-style Ctrl-b of the default keymap is a Mac key only.
  expect(KEYS.some((k) => k.mac === "Ctrl-b" && k.key === undefined)).toBe(true);
});

test("the_panel_keys_are_bound_once_in_the_action_table", () => {
  const bound = (key: string) => actions.filter((a) => a.keys.includes(key)).map((a) => a.id);
  expect(bound("Ctrl+B")).toEqual(["panel.left.toggle"]);
  expect(bound("Ctrl+Alt+B")).toEqual(["panel.right.toggle"]);
  expect(findDuplicateBindings()).toEqual([]);
});

test("every_shortcut_that_works_inside_the_text_is_free_of_the_editors_own_keys", () => {
  // The shortcuts that fire in an editable field must not shadow a key CodeMirror binds on Linux.
  const editors = new Set(LINUX_KEYS().map((k) => k.replace(/^Mod-/, "Ctrl-").toLowerCase()));
  const clashes = actions
    .filter((a) => a.inEditable)
    .flatMap((a) => a.keys.map((k) => ({ id: a.id, key: k })))
    .filter(({ key }) => editors.has(key.replace(/\+/g, "-").toLowerCase()));
  // Ctrl+Shift+S, Ctrl+S, Ctrl+W and the rest are not CodeMirror's; Ctrl+Tab is not either.
  expect(clashes).toEqual([]);
});
