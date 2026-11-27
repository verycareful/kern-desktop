// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test } from "vitest";
import { dropPageTextSelection, pageTextSelected, pageTextSelectedIn } from "./text-selection";

afterEach(() => {
  window.getSelection()!.removeAllRanges();
  document.body.innerHTML = "";
});

function page() {
  document.body.innerHTML = `
    <div id="dialog"><p id="inside">The path could not be copied</p></div>
    <p id="outside">an ordinary line</p>
    <input id="field" value="typed text" />
    <div id="editor" contenteditable="true">edited text</div>`;
  return (id: string) => document.getElementById(id)!;
}

const selectWords = (el: Element) => window.getSelection()!.selectAllChildren(el);

function selectAcross(from: Element, to: Element) {
  const range = document.createRange();
  range.setStart(from.firstChild!, 2);
  range.setEnd(to.firstChild!, 3);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

test("words_of_the_page_count_and_nothing_or_a_caret_does_not", () => {
  const el = page();
  expect(pageTextSelected()).toBe(false);
  selectWords(el("outside"));
  expect(pageTextSelected()).toBe(true);
  window.getSelection()!.collapse(el("outside").firstChild!, 2);
  expect(pageTextSelected()).toBe(false);
});

test("a_selection_in_a_field_or_an_editor_is_not_the_page_s", () => {
  const el = page();
  selectWords(el("editor"));
  expect(pageTextSelected()).toBe(false);
  // One end in the editor makes it the editor's.
  selectAcross(el("outside"), el("editor"));
  expect(pageTextSelected()).toBe(false);
});

test("inside_a_root_means_both_ends_inside_it", () => {
  const el = page();
  selectWords(el("inside"));
  expect(pageTextSelectedIn(el("dialog"))).toBe(true);
  expect(pageTextSelectedIn(null)).toBe(false);
  selectAcross(el("inside"), el("outside"));
  expect(pageTextSelectedIn(el("dialog"))).toBe(false);
  selectWords(el("outside"));
  expect(pageTextSelectedIn(el("dialog"))).toBe(false);
});

test("drop_clears_the_page_s_words_and_leaves_an_editor_s_selection", () => {
  const el = page();
  selectWords(el("outside"));
  dropPageTextSelection();
  expect(window.getSelection()!.isCollapsed).toBe(true);
  selectWords(el("editor"));
  dropPageTextSelection();
  expect(window.getSelection()!.toString()).toBe("edited text");
});
