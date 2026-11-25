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
import { ToolsPanel } from "./ToolsPanel";

const p = (v: string): WirePath => ({ k: "Utf8", v });

let tabId = "";
beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useViewSettings.setState({ pdfLayout: "scroll", pdfPanels: DEFAULT_PANELS });
  vi.mocked(settingsSet).mockReset();
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  tabId = useTabs.getState().activeId as string;
  registerPdf(tabId, {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomFit: vi.fn(),
    askGoToPage: vi.fn(),
    goToPage: vi.fn(),
  });
});

test("expanded_shows_each_tool_with_its_name", () => {
  render(<ToolsPanel tabId={tabId} collapsed={false} />);
  for (const name of [
    "Find",
    "Select",
    "Continuous scroll",
    "Single page",
    "Two pages",
    "Grid of pages",
  ]) {
    expect(screen.getByRole("button", { name })).toHaveTextContent(name);
  }
});

test("collapsed_shows_icons_only_with_labels_as_titles", () => {
  render(<ToolsPanel tabId={tabId} collapsed />);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(6);
  for (const b of buttons) {
    expect(b).toHaveTextContent("");
    expect(b.getAttribute("title")).toContain(b.getAttribute("aria-label"));
    expect(b.querySelector("svg")).not.toBeNull();
  }
});

test("find_and_select_are_off_until_their_sessions_switch_them_on", () => {
  render(<ToolsPanel tabId={tabId} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
});

test("a_layout_button_runs_the_layout_action_and_the_current_layout_is_pressed", () => {
  useViewSettings.setState({ pdfLayout: "spread" });
  render(<ToolsPanel tabId={tabId} collapsed={false} />);
  expect(screen.getByRole("button", { name: "Two pages" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Grid of pages" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  fireEvent.click(screen.getByRole("button", { name: "Grid of pages" }));
  expect(settingsSet).toHaveBeenCalledWith({ pdf_layout: "grid" });
});
