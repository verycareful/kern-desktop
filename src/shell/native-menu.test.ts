// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test } from "vitest";
import { blockNativeMenu } from "./native-menu";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
  document.body.replaceChildren();
});

/** Right-clicks `el` and says whether the web view's menu would show. */
function rightClick(el: Element): boolean {
  return el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
}

function add<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  document.body.append(el);
  return el;
}

test("a_right_click_outside_a_text_field_shows_no_web_view_menu", () => {
  undo = blockNativeMenu(document);
  expect(rightClick(add("div"))).toBe(false);
  expect(rightClick(add("button"))).toBe(false);
});

test("text_fields_keep_the_web_view_menu", () => {
  undo = blockNativeMenu(document);
  expect(rightClick(add("input"))).toBe(true);
  expect(rightClick(add("textarea"))).toBe(true);
  const editable = add("div");
  editable.setAttribute("contenteditable", "true");
  const inner = document.createElement("span");
  editable.append(inner);
  expect(rightClick(inner)).toBe(true);
});

test("removing_the_block_gives_the_menu_back", () => {
  blockNativeMenu(document)();
  expect(rightClick(add("div"))).toBe(true);
});
