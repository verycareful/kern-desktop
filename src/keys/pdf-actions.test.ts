// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";
import { registerPdf, type PdfController } from "../pdf/pdf-controller";
import { useTabs } from "../store/tabs";
import {
  candidateKeys,
  currentContext,
  findDuplicateBindings,
  getAction,
  isEnabled,
  runAction,
} from "./actions";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const controller = (): PdfController => ({
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomFit: vi.fn(),
  askGoToPage: vi.fn(),
});

beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

const openPdf = () => {
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  return useTabs.getState().activeId as string;
};

test("the_pdf_actions_run_on_the_viewer_of_the_active_pdf", () => {
  const id = openPdf();
  const c = controller();
  const off = registerPdf(id, c);
  const ctx = currentContext();
  runAction(getAction("pdf.zoomIn"), ctx);
  runAction(getAction("pdf.zoomOut"), ctx);
  runAction(getAction("pdf.zoomFit"), ctx);
  runAction(getAction("pdf.goToPage"), ctx);
  expect(c.zoomIn).toHaveBeenCalledTimes(1);
  expect(c.zoomOut).toHaveBeenCalledTimes(1);
  expect(c.zoomFit).toHaveBeenCalledTimes(1);
  expect(c.askGoToPage).toHaveBeenCalledTimes(1);
  off();
});

test("the_pdf_actions_are_off_for_a_text_document_and_for_a_pdf_that_is_not_mounted", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, controller());
  for (const id of ["pdf.zoomIn", "pdf.zoomOut", "pdf.zoomFit", "pdf.goToPage"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
  openPdf();
  for (const id of ["pdf.zoomIn", "pdf.zoomOut", "pdf.zoomFit", "pdf.goToPage"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
});

test("ctrl_plus_is_found_on_a_layout_where_plus_is_shifted_and_on_one_where_it_is_not", () => {
  const zoomIn = getAction("pdf.zoomIn").keys;
  const typed = (key: string, shiftKey: boolean) =>
    candidateKeys({ key, code: "", ctrlKey: true, altKey: false, shiftKey, metaKey: false });
  expect(zoomIn).toContain(typed("=", false)[0]);
  expect(zoomIn).toContain(typed("+", true)[0]);
  expect(zoomIn).toContain(typed("+", false)[0]);
  expect(getAction("pdf.zoomOut").keys).toContain(typed("-", false)[0]);
  expect(getAction("pdf.zoomFit").keys).toContain(typed("0", false)[0]);
  expect(getAction("pdf.goToPage").keys).toContain(typed("g", false)[0]);
});

test("the_pdf_keys_collide_with_no_other_action", () => {
  expect(findDuplicateBindings()).toEqual([]);
});
