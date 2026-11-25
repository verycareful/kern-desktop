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

test("a_changed_pdf_is_at_risk_when_closed_and_has_no_way_to_save", () => {
  mount({ modified: true });
  expect(docController("t1")?.closeRisk()).toEqual({
    dirty: true,
    deleted: false,
    readOnly: false,
    unsavable: true,
  });
  expect(docController("t1")?.canSave()).toBe(false);
  expect(docController("t1")?.canSaveAs()).toBe(false);
  expect(docController("t1")?.whySaveRefused()).toMatch(/saving a PDF is not available yet/);
});

test("an_unchanged_pdf_closes_without_a_question", () => {
  mount();
  expect(docController("t1")?.closeRisk()).toBeNull();
  expect(docController("t1")?.whySaveRefused()).toBeNull();
});

test("a_change_still_with_the_engine_counts_as_made", () => {
  mount({ busy: () => true });
  expect(docController("t1")?.closeRisk()).toMatchObject({ dirty: true, unsavable: true });
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

test("a_changed_pdf_is_not_moved_to_another_window_and_the_tab_stays", async () => {
  mount({ modified: true });
  await moveTabToWindow("t1");
  expect(ipc.detachDoc).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(["t1"]);
  expect(useOps.getState().notice?.text).toMatch(
    /book\.pdf was not moved to a new window: it has changes that are not saved/
  );
});

test("an_unchanged_pdf_moves_with_its_format_and_no_state", async () => {
  mount();
  ipc.detachDoc.mockResolvedValue("doc-1");
  await moveTabToWindow("t1");
  expect(ipc.detachDoc).toHaveBeenCalledWith("t1", FILE, null, "pdf");
  expect(useTabs.getState().tabs).toEqual([]);
});
