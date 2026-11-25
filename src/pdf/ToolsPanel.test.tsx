// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  settingsSet: vi.fn(),
}));
import { settingsSet, type WirePath } from "../ipc";
import { useViewSettings } from "../files/view-settings";
import { useTabs } from "../store/tabs";
import { DEFAULT_PANELS } from "./panel-placement";
import { registerPdf } from "./pdf-controller";
import { testController, testDoc } from "./test-doc";
import { ToolsPanel } from "./ToolsPanel";

const p = (v: string): WirePath => ({ k: "Utf8", v });

let tabId = "";
let controller = testController();
beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
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
    "Select",
    "Rotate page clockwise",
    "Rotate page counterclockwise",
    "Rotate all pages clockwise",
    "Rotate all pages counterclockwise",
    "Undo",
    "Redo",
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
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(12);
  for (const b of buttons) {
    expect(b).toHaveTextContent("");
    expect(b.getAttribute("title")).toContain(b.getAttribute("aria-label"));
    expect(b.querySelector("svg")).not.toBeNull();
  }
});

test("find_and_select_are_off_until_their_sessions_switch_them_on", () => {
  render(<ToolsPanel tabId={tabId} doc={testDoc()} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
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
