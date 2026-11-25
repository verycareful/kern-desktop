// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";
import { registerPdf } from "../pdf/pdf-controller";
import { testController } from "../pdf/test-doc";
import { usePdfView } from "../pdf/pdf-view";
import { useTabs } from "../store/tabs";
import { StatusBar } from "./StatusBar";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  usePdfView.setState({ byTab: {} });
  useTabs.setState({ tabs: [], activeId: null });
});

const openPdf = () => {
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  return useTabs.getState().activeId as string;
};

test("a_pdf_shows_its_page_out_of_its_pages_and_its_zoom", () => {
  const id = openPdf();
  usePdfView.getState().patch(id, { page: 2, pages: 1234, zoom: 1.25 });
  render(<StatusBar />);
  expect(screen.getByTestId("status-page")).toHaveTextContent("3 / 1,234");
  expect(screen.getByTestId("status-zoom")).toHaveTextContent("125%");
});

test("the_counter_opens_go_to_page", () => {
  const id = openPdf();
  const askGoToPage = vi.fn();
  registerPdf(id, testController({ askGoToPage }));
  usePdfView.getState().patch(id, { page: 0, pages: 5, zoom: 1 });
  render(<StatusBar />);
  fireEvent.click(screen.getByTestId("status-page"));
  expect(askGoToPage).toHaveBeenCalledTimes(1);
});

test("a_pdf_not_yet_measured_shows_the_pages_and_no_zoom", () => {
  const id = openPdf();
  usePdfView.getState().patch(id, { pages: 5 });
  render(<StatusBar />);
  expect(screen.getByTestId("status-page")).toHaveTextContent("1 / 5");
  expect(screen.queryByTestId("status-zoom")).toBeNull();
});

test("a_text_document_and_a_pdf_with_no_pages_show_no_counter", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  render(<StatusBar />);
  expect(screen.queryByTestId("status-page")).toBeNull();
});
