// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";
import { useBinds } from "../keys/binds";
import { useShortcuts } from "../keys/useShortcuts";
import { useTabs } from "../store/tabs";
import { registerPdf, type PdfController } from "./pdf-controller";
import { testController } from "./test-doc";

// The edit keys as the window receives them: the PDF's own Ctrl+Z, Ctrl+Y and Ctrl+R while a PDF
// is in front, and a field that has the focus keeps its own.

const p = (v: string): WirePath => ({ k: "Utf8", v });

function Host() {
  useShortcuts();
  return <input aria-label="field" />;
}

let c: PdfController;
beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useBinds.setState({ loaded: true, overrides: {}, error: null });
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  c = testController();
  registerPdf(useTabs.getState().activeId as string, c);
});

const press = (key: string, shiftKey = false, target: Element | Window = window) =>
  fireEvent.keyDown(target, { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, shiftKey });

test("ctrl_r_and_ctrl_shift_r_turn_the_page_and_are_claimed_from_the_webview", () => {
  render(<Host />);
  expect(press("r")).toBe(false);
  expect(c.rotate).toHaveBeenLastCalledWith(90, "page");
  expect(press("R", true)).toBe(false);
  expect(c.rotate).toHaveBeenLastCalledWith(270, "page");
});

test("ctrl_z_undoes_and_ctrl_y_and_ctrl_shift_z_redo", () => {
  render(<Host />);
  press("z");
  expect(c.undo).toHaveBeenCalledTimes(1);
  press("y");
  press("Z", true);
  expect(c.redo).toHaveBeenCalledTimes(2);
});

test("a_field_that_has_the_focus_keeps_its_own_undo_and_the_pdf_is_not_touched", () => {
  render(<Host />);
  const field = screen.getByLabelText("field");
  // Not claimed: the field's own undo runs.
  expect(press("z", false, field)).toBe(true);
  expect(press("y", false, field)).toBe(true);
  expect(c.undo).not.toHaveBeenCalled();
  expect(c.redo).not.toHaveBeenCalled();
});

test("a_key_the_viewer_cannot_use_now_is_claimed_and_does_nothing", () => {
  c = testController({ canEdit: () => false, canUndo: () => false });
  registerPdf(useTabs.getState().activeId as string, c);
  render(<Host />);
  // Ctrl+R still must not reload the webview.
  expect(press("r")).toBe(false);
  expect(c.rotate).not.toHaveBeenCalled();
  press("z");
  expect(c.undo).not.toHaveBeenCalled();
});

test("ctrl_r_in_a_text_document_does_not_reload_the_webview", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  render(<Host />);
  expect(press("r")).toBe(false);
  expect(vi.mocked(c.rotate)).not.toHaveBeenCalled();
});
