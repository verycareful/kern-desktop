// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";
import type { HandedDoc } from "../editor/handed-doc";

const seen = vi.hoisted(() => ({ text: vi.fn(), pdf: vi.fn() }));
vi.mock("../editor/TextEditor", () => ({
  TextEditor: (props: unknown) => {
    seen.text(props);
    return <div data-testid="text-view" />;
  },
}));
vi.mock("./PdfViewer", () => ({
  PdfViewer: (props: unknown) => {
    seen.pdf(props);
    return <div data-testid="pdf-view" />;
  },
}));

import { DocView } from "./DocView";

const FILE: WirePath = { k: "Utf8", v: "/home/a/book.pdf" };
const handed: HandedDoc = {
  text: "hello",
  saved: "hello",
  stamp: "s1",
  ending: "lf",
  bom: false,
  read_only: null,
};

test("a_tab_with_no_format_is_a_text_document", () => {
  render(<DocView tabId="t1" path={FILE} active />);
  expect(screen.getByTestId("text-view")).toBeInTheDocument();
  expect(screen.queryByTestId("pdf-view")).toBeNull();
});

test("a_pdf_tab_is_a_PDF_document_and_the_format_is_not_passed_on", () => {
  seen.pdf.mockClear();
  render(<DocView tabId="t1" path={FILE} active format="pdf" registered />);
  expect(screen.getByTestId("pdf-view")).toBeInTheDocument();
  expect(screen.queryByTestId("text-view")).toBeNull();
  expect(seen.pdf).toHaveBeenCalledWith({
    tabId: "t1",
    path: FILE,
    active: true,
    registered: true,
  });
});

test("a_text_tab_gets_the_text_that_was_handed_over", () => {
  seen.text.mockClear();
  render(<DocView tabId="t1" path={FILE} active handed={handed} />);
  expect(seen.text).toHaveBeenCalledWith({ tabId: "t1", path: FILE, active: true, handed });
});
