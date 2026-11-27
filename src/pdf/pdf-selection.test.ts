// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test } from "vitest";
import { usePdfSelection } from "./pdf-selection";

afterEach(() => {
  window.getSelection()!.removeAllRanges();
  document.body.innerHTML = "";
  usePdfSelection.setState({ byTab: {}, searches: {} });
});

test("selecting_text_on_a_pdf_page_drops_the_words_selected_on_the_page_around_it", () => {
  const words = document.body.appendChild(document.createElement("p"));
  words.textContent = "The text could not be read";
  window.getSelection()!.selectAllChildren(words);
  const at = { line: 0, unit: 0 };
  usePdfSelection.getState().select("t1", { page: 0, from: at, to: { line: 0, unit: 3 } });
  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(usePdfSelection.getState().byTab.t1?.page).toBe(0);
});
