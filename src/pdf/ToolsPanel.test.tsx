// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  settingsSet: vi.fn(),
}));
import { settingsSet, type WirePath } from "../ipc";
import { useViewSettings } from "../files/view-settings";
import { useTabs } from "../store/tabs";
import { PALETTE } from "./annotations";
import { usePageSelection } from "./page-selection";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool } from "./pdf-tool";
import { DEFAULT_PANELS } from "./panel-placement";
import { registerPdf } from "./pdf-controller";
import { testController, testDoc } from "./test-doc";
import { ToolsPanel } from "./ToolsPanel";

const p = (v: string): WirePath => ({ k: "Utf8", v });

let tabId = "";
let controller = testController();
beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  usePageSelection.setState({ byTab: {} });
  usePdfSelection.setState({ byTab: {}, searches: {} });
  usePdfTool.setState({ byTab: {}, listed: {} });
  useViewSettings.setState({ pdfLayout: "scroll", pdfPanels: DEFAULT_PANELS });
  vi.mocked(settingsSet).mockReset();
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  tabId = useTabs.getState().activeId as string;
  controller = testController();
  registerPdf(tabId, controller);
});

test("expanded_shows_each_tool_with_its_name", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  for (const name of [
    "Find",
    "Select all text",
    "Rotate page clockwise",
    "Rotate page counterclockwise",
    "Rotate all pages clockwise",
    "Rotate all pages counterclockwise",
    "Undo",
    "Redo",
    "Remove chosen pages",
    "Merge PDFs…",
    "Extract pages…",
    "Split into files…",
    "Continuous scroll",
    "Single page",
    "Two pages",
    "Grid of pages",
  ]) {
    expect(screen.getByRole("button", { name })).toHaveTextContent(name);
  }
});

test("collapsed_shows_icons_only_with_labels_as_titles", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed />);
  // The colours and the pen widths are swatches, not tools: they have no name to show.
  const buttons = screen.getAllByRole("button").filter((b) => !b.closest(".kern-pdf-colours"));
  expect(buttons).toHaveLength(24);
  for (const b of buttons) {
    expect(b).toHaveTextContent("");
    expect(b.getAttribute("title")).toContain(b.getAttribute("aria-label"));
    expect(b.querySelector("svg")).not.toBeNull();
  }
});

test("find_runs_the_find_action_and_waits_for_a_document_with_pages", () => {
  const { rerender } = render(
    <ToolsPanel tabId={tabId} doc={testDoc({ pages: 0 })} collapsed={false} />
  );
  expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
  rerender(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(controller.openFind).toHaveBeenCalledTimes(1);
});

test("select_all_text_runs_the_select_all_action_and_waits_for_a_document_with_pages", () => {
  const { rerender } = render(
    <ToolsPanel tabId={tabId} doc={testDoc({ pages: 0 })} collapsed={false} />
  );
  expect(screen.getByRole("button", { name: "Select all text" })).toBeDisabled();
  rerender(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Select all text" }));
  expect(controller.selectAll).toHaveBeenCalledTimes(1);
});

test("a_layout_button_runs_the_layout_action_and_the_current_layout_is_pressed", () => {
  useViewSettings.setState({ pdfLayout: "spread" });
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Two pages" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Grid of pages" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  fireEvent.click(screen.getByRole("button", { name: "Grid of pages" }));
  expect(settingsSet).toHaveBeenCalledWith({ pdf_layout: "grid" });
});

test("a_rotate_button_runs_its_action_on_the_viewer", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Rotate page clockwise" }));
  fireEvent.click(screen.getByRole("button", { name: "Rotate page counterclockwise" }));
  fireEvent.click(screen.getByRole("button", { name: "Rotate all pages clockwise" }));
  fireEvent.click(screen.getByRole("button", { name: "Rotate all pages counterclockwise" }));
  expect(controller.rotate).toHaveBeenNthCalledWith(1, 90, "page");
  expect(controller.rotate).toHaveBeenNthCalledWith(2, 270, "page");
  expect(controller.rotate).toHaveBeenNthCalledWith(3, 90, "all");
  expect(controller.rotate).toHaveBeenNthCalledWith(4, 270, "all");
});

test("undo_and_redo_follow_what_the_document_can_do", () => {
  const { rerender } = render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  rerender(<ToolsPanel tabId={tabId} doc={testDoc({ canUndo: true })} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(controller.undo).toHaveBeenCalledTimes(1);
  rerender(<ToolsPanel tabId={tabId} doc={testDoc({ canRedo: true })} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
});

test("no_edit_tool_is_on_for_a_document_that_cannot_be_changed", () => {
  render(
    <ToolsPanel
      tabId={tabId}
      doc={testDoc({ canEdit: false, canUndo: true, canRedo: true })}
      collapsed={false}
    />
  );
  for (const name of ["Rotate page clockwise", "Rotate all pages clockwise", "Undo", "Redo"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
});

test("merge_extract_and_split_run_their_actions_whenever_the_document_has_pages", () => {
  const { rerender } = render(
    <ToolsPanel tabId={tabId} doc={testDoc({ pages: 0 })} collapsed={false} />
  );
  for (const name of ["Merge PDFs…", "Extract pages…", "Split into files…"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  rerender(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Merge PDFs…" }));
  fireEvent.click(screen.getByRole("button", { name: "Extract pages…" }));
  fireEvent.click(screen.getByRole("button", { name: "Split into files…" }));
  expect(controller.askMerge).toHaveBeenCalledTimes(1);
  expect(controller.askExtract).toHaveBeenCalledTimes(1);
  expect(controller.askSplit).toHaveBeenCalledTimes(1);
});

test("remove_chosen_pages_waits_for_a_choice_and_for_a_document_that_can_be_changed", () => {
  const { rerender } = render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Remove chosen pages" })).toBeDisabled();
  act(() => usePageSelection.getState().set(tabId, [1]));
  expect(screen.getByRole("button", { name: "Remove chosen pages" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Remove chosen pages" }));
  expect(controller.removeSelection).toHaveBeenCalledTimes(1);
  rerender(<ToolsPanel tabId={tabId} doc={testDoc({ canEdit: false })} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Remove chosen pages" })).toBeDisabled();
});

test("the_tool_in_hand_is_pressed_and_choosing_another_runs_its_action", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Select text and annotations" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: "Draw with the pen" }));
  expect(controller.setTool).toHaveBeenCalledWith("ink");
  act(() => usePdfTool.getState().setTool(tabId, "ink"));
  expect(screen.getByRole("button", { name: "Draw with the pen" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(screen.getByRole("button", { name: "Add or open a note" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("edit_text_takes_the_tool_and_its_limits_are_written_beside_it_while_it_is_in_hand", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.queryByTestId("pdf-edit-text-help")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
  expect(controller.setTool).toHaveBeenCalledWith("editText");
  act(() => usePdfTool.getState().setTool(tabId, "editText"));
  expect(screen.getByRole("button", { name: "Edit text" })).toHaveAttribute("aria-pressed", "true");
  const help = screen.getByTestId("pdf-edit-text-help");
  expect(help).toHaveTextContent(/not shaped/);
  expect(help).toHaveTextContent(/Vertical text/);
  expect(help).toHaveTextContent(/one font|keeps its font/);
});

test("collapsed_edit_text_carries_its_limits_in_its_title", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed />);
  expect(screen.getByRole("button", { name: "Edit text" }).getAttribute("title")).toMatch(
    /Vertical text/
  );
});

test("the_pen_and_the_note_wait_for_a_document_that_can_be_changed", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc({ canEdit: false })} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Draw with the pen" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add or open a note" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Edit text" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select text and annotations" })).toBeEnabled();
});

test("the_markup_tools_wait_for_selected_text_and_delete_waits_for_a_picked_annotation", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  const mark = "Highlight the selected text";
  const del = "Delete the picked annotation";
  expect(screen.getByRole("button", { name: mark })).toBeDisabled();
  expect(screen.getByRole("button", { name: del })).toBeDisabled();
  act(() => {
    usePdfSelection
      .getState()
      .select(tabId, { page: 0, from: { line: 0, unit: 0 }, to: { line: 0, unit: 2 } });
    usePdfTool.getState().pick(tabId, { page: 0, id: { object: 3, generation: 0 } });
  });
  expect(screen.getByRole("button", { name: mark })).toBeEnabled();
  expect(screen.getByRole("button", { name: del })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: mark }));
  expect(controller.mark).toHaveBeenCalledWith("highlight");
  fireEvent.click(screen.getByRole("button", { name: del }));
  expect(controller.deletePicked).toHaveBeenCalledTimes(1);
});

test("a_colour_and_a_pen_width_are_chosen_for_the_tab", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Colour Green" }));
  expect(usePdfTool.getState().byTab[tabId]?.colour).toEqual(PALETTE[1]!.rgb);
  expect(screen.getByRole("button", { name: "Colour Green" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: "Pen width 4 points" }));
  expect(usePdfTool.getState().byTab[tabId]?.inkWidth).toBe(4);
});
