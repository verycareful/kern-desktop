// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { PageFileDialogs } from "./PageFileDialogs";
import { usePageDialog } from "./pdf-page-dialog";
import { testDoc } from "./test-doc";

beforeEach(() => usePageDialog.setState({ byTab: {} }));
afterEach(cleanup);

test("nothing_shows_until_the_tab_asks_for_a_dialog", () => {
  render(<PageFileDialogs tabId="t1" doc={testDoc()} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("each_kind_opens_its_own_dialog_and_close_removes_it", () => {
  render(<PageFileDialogs tabId="t1" doc={testDoc()} />);
  act(() => usePageDialog.getState().open("t1", { kind: "merge" }));
  expect(screen.getByRole("dialog", { name: "Merge PDFs" })).toBeInTheDocument();
  act(() => usePageDialog.getState().open("t1", { kind: "extract", pages: "2-3" }));
  expect(screen.getByRole("dialog", { name: "Extract pages" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /^Pages of/ })).toHaveValue("2-3");
  act(() => usePageDialog.getState().open("t1", { kind: "split", pages: "" }));
  expect(screen.getByRole("dialog", { name: "Split into files" })).toBeInTheDocument();
  act(() => usePageDialog.getState().close("t1"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("another_tabs_dialog_is_not_shown_and_a_document_that_is_not_open_has_none", () => {
  const view = render(<PageFileDialogs tabId="t1" doc={testDoc()} />);
  act(() => usePageDialog.getState().open("t2", { kind: "merge" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => usePageDialog.getState().open("t1", { kind: "merge" }));
  view.rerender(<PageFileDialogs tabId="t1" doc={testDoc({ phase: "opening" })} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
