// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  detachDoc: vi.fn(),
  isMainWindow: vi.fn(),
  isEditorWindow: vi.fn(),
  isDocumentWindow: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { docController } from "../editor/doc-controller";
import { useOps } from "../ops/useOps";
import { moveTabToWindow } from "../shell/move-doc";
import { useCloseGuard } from "../shell/useCloseGuard";
import { useTabs } from "../store/tabs";
import { usePdfDocController } from "./pdf-doc-controller";
import { testDoc } from "./test-doc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");

const mount = (over: Parameters<typeof testDoc>[0] = {}) =>
  renderHook(({ doc }) => usePdfDocController("t1", doc), {
    initialProps: { doc: testDoc(over) },
  });

beforeEach(() => {
  vi.clearAllMocks();
  useOps.setState({ notice: null });
  useCloseGuard.getState().reset();
  ipc.isMainWindow.mockReturnValue(true);
  ipc.isEditorWindow.mockReturnValue(false);
  ipc.isDocumentWindow.mockReturnValue(false);
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
});

test("a_changed_pdf_is_at_risk_when_closed_and_can_be_saved", async () => {
  const saveForClose = vi.fn(async () => true);
  const save = vi.fn(async () => null);
  mount({ modified: true, saveForClose, save });
  const ctl = docController("t1");
  expect(ctl?.closeRisk()).toEqual({ dirty: true, deleted: false, readOnly: false });
  expect(ctl?.canSave()).toBe(true);
  expect(ctl?.canSaveAs()).toBe(true);
  expect(ctl?.whySaveRefused()).toBeNull();
  ctl?.save();
  expect(save).toHaveBeenCalledTimes(1);
  await expect(ctl?.saveForClose()).resolves.toBe(true);
  expect(saveForClose).toHaveBeenCalledTimes(1);
});

test("an_unchanged_pdf_closes_without_a_question_and_has_nothing_to_save", () => {
  mount();
  expect(docController("t1")?.closeRisk()).toBeNull();
  expect(docController("t1")?.whySaveRefused()).toBeNull();
  expect(docController("t1")?.canSave()).toBe(false);
  expect(docController("t1")?.canSaveAs()).toBe(true);
});

test("a_pdf_whose_file_was_deleted_can_be_saved_again_and_is_at_risk", () => {
  mount({ externalChange: "gone" });
  expect(docController("t1")?.canSave()).toBe(true);
  expect(docController("t1")?.closeRisk()).toEqual({
    dirty: false,
    deleted: true,
    readOnly: false,
  });
});

test("a_read_only_pdf_is_not_saved_in_place_and_says_why", () => {
  mount({ modified: true, readOnly: { kind: "OpenElsewhere", detail: "editor-2" } });
  const ctl = docController("t1");
  expect(ctl?.canSave()).toBe(false);
  expect(ctl?.canSaveAs()).toBe(true);
  expect(ctl?.closeRisk()).toMatchObject({ dirty: true, readOnly: true });
  expect(ctl?.whySaveRefused()).toMatch(/read-only here\. Use Save As/);
});

test("a_save_in_progress_refuses_a_second_and_says_so", () => {
  mount({ modified: true, saving: true });
  const ctl = docController("t1");
  expect(ctl?.canSave()).toBe(false);
  expect(ctl?.whySaveRefused()).toBe("A save is already under way.");
});

test("a_change_still_with_the_engine_counts_as_made", () => {
  mount({ busy: () => true });
  expect(docController("t1")?.closeRisk()).toMatchObject({ dirty: true });
  expect(docController("t1")?.busy()).toBe(true);
});

test("the_controller_reads_the_document_as_it_is_when_asked", () => {
  const view = mount();
  expect(docController("t1")?.closeRisk()).toBeNull();
  view.rerender({ doc: testDoc({ modified: true }) });
  expect(docController("t1")?.closeRisk()).not.toBeNull();
});

test("the_controller_goes_when_the_viewer_does", () => {
  const view = mount();
  expect(docController("t1")).toBeDefined();
  view.unmount();
  expect(docController("t1")).toBeUndefined();
});

test("a_dirty_pdf_cannot_move_to_another_window", async () => {
  mount({ modified: true });
  await moveTabToWindow("t1");
  expect(ipc.detachDoc).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["t1"]);
  expect(useOps.getState().notice?.text).toMatch(
    /book\.pdf was not moved to a new window: it has changes that are not saved.*save this PDF before moving it to another window/
  );
});

test("a_pdf_that_moves_takes_no_edit_meanwhile", async () => {
  const setMoving = vi.fn();
  mount({ setMoving });
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("t1");
  expect(setMoving).toHaveBeenCalledWith(true);
});

test("an_unchanged_pdf_moves_with_its_format_and_no_state", async () => {
  mount();
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("t1");
  expect(ipc.detachDoc).toHaveBeenCalledWith("t1", FILE, null, "pdf");
  expect(useTabs.getState().tabs).toEqual([]);
});
