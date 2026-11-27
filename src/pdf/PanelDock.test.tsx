// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfPageInfo, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfPageInfo: vi.fn(),
  pdfRenderSize: vi.fn(),
  pdfRender: vi.fn(),
  pdfCancelJob: vi.fn(),
  settingsSet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useViewSettings } from "../files/view-settings";
import { SETTINGS } from "../settings/test-settings";
import { useTabs } from "../store/tabs";
import { PanelDock } from "./PanelDock";
import { DEFAULT_PANELS, movePanel, toggleCollapsed } from "./panel-placement";
import { usePdfTool } from "./pdf-tool";
import { usePdfView } from "./pdf-view";
import { THUMB_WIDTH, thumbCache, thumbKey } from "./thumb-cache";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const info = (width_pt: number, height_pt: number): PdfPageInfo => ({
  width_pt,
  height_pt,
  rotate: 0,
  crop_box: [0, 0, width_pt, height_pt],
});
const doc = (over: Partial<PdfDoc> = {}): PdfDoc => testDoc(over);

let tabId = "";
beforeEach(() => {
  vi.clearAllMocks();
  usePdfView.setState({ byTab: {} });
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  tabId = useTabs.getState().activeId as string;
  useViewSettings.setState({ pdfLayout: "scroll", pdfGridAcross: 4, pdfPanels: DEFAULT_PANELS });
  // The stored settings answer a patch with themselves, as the backend does.
  ipc.settingsSet.mockImplementation(async (patch: object) => {
    const next = { ...SETTINGS, ...patch } as typeof SETTINGS;
    useViewSettings.setState({ pdfPanels: next.pdf_panels });
    return next;
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  ipc.pdfPageInfo.mockResolvedValue(info(600, 800));
  ipc.pdfCancelJob.mockResolvedValue({ running: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dock = async (over: Partial<PdfDoc> = {}) => {
  const view = render(<PanelDock tabId={tabId} doc={doc(over)} active />);
  await screen.findByTestId("pdf-pages");
  return view;
};
const setPanels = (panels: typeof DEFAULT_PANELS) =>
  act(() => useViewSettings.setState({ pdfPanels: panels }));

test("by_default_thumbnails_stand_left_of_the_pages_and_tools_above_them", async () => {
  await dock();
  const top = screen.getByTestId("pdf-dock-top");
  const left = screen.getByTestId("pdf-dock-left");
  expect(within(top).getByTestId("pdf-panel-tools")).toHaveAttribute("data-side", "top");
  expect(within(left).getByTestId("pdf-panel-thumbnails")).toBeInTheDocument();
  expect(screen.queryByTestId("pdf-dock-right")).toBeNull();
  expect(screen.queryByTestId("pdf-dock-bottom")).toBeNull();
  const follows = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const pages = screen.getByTestId("pdf-scroll");
  expect(follows(top, pages)).toBe(true);
  expect(follows(left, pages)).toBe(true);
});

test("the_tools_can_stand_right_of_the_pages", async () => {
  await dock();
  setPanels(movePanel(DEFAULT_PANELS, "tools", "right"));
  expect(screen.queryByTestId("pdf-dock-top")).toBeNull();
  const right = screen.getByTestId("pdf-dock-right");
  expect(within(right).getByTestId("pdf-panel-tools")).toHaveAttribute("data-side", "right");
  const pages = screen.getByTestId("pdf-scroll");
  expect(Boolean(pages.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
    true
  );
});

test("the_tools_stand_on_the_bottom_under_the_thumbnail_strip_and_the_pages", async () => {
  await dock();
  setPanels(movePanel(movePanel(DEFAULT_PANELS, "thumbnails", "bottom"), "tools", "bottom"));
  const bottom = screen.getByTestId("pdf-dock-bottom");
  const panels = within(bottom).getAllByRole("complementary");
  expect(panels.map((a) => a.getAttribute("data-testid"))).toEqual([
    "pdf-panel-thumbnails",
    "pdf-panel-tools",
  ]);
  const pages = screen.getByTestId("pdf-scroll");
  expect(Boolean(pages.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
    true
  );
  expect(within(bottom).getByTestId("pdf-tools")).toHaveAttribute("data-form", "bar");
});

test("a_panel_sits_on_the_side_the_settings_name_and_the_strip_runs_along_the_bottom", async () => {
  await dock();
  setPanels(movePanel(movePanel(DEFAULT_PANELS, "thumbnails", "bottom"), "tools", "left"));
  expect(screen.queryByTestId("pdf-dock-right")).toBeNull();
  expect(within(screen.getByTestId("pdf-dock-left")).getByTestId("pdf-panel-tools")).toBeVisible();
  const bottom = screen.getByTestId("pdf-dock-bottom");
  expect(within(bottom).getByTestId("pdf-panel-thumbnails")).toHaveAttribute("data-side", "bottom");
  expect(within(bottom).getByTestId("pdf-thumbs")).toHaveClass("kern-pdf-thumbs-row");
});

test("both_panels_on_one_side_are_two_columns_with_the_tools_at_the_outer_edge", async () => {
  await dock();
  const order = (side: "left" | "right") =>
    within(screen.getByTestId(`pdf-dock-${side}`))
      .getAllByRole("complementary")
      .map((a) => a.getAttribute("data-testid"));
  setPanels(movePanel(DEFAULT_PANELS, "tools", "left"));
  expect(order("left")).toEqual(["pdf-panel-tools", "pdf-panel-thumbnails"]);
  setPanels(movePanel(movePanel(DEFAULT_PANELS, "thumbnails", "right"), "tools", "right"));
  expect(order("right")).toEqual(["pdf-panel-thumbnails", "pdf-panel-tools"]);
});

test("a_folded_rail_has_its_options_in_a_column_on_the_page_side_while_the_pen_is_in_hand", async () => {
  await dock();
  setPanels(toggleCollapsed(movePanel(DEFAULT_PANELS, "tools", "left"), "tools"));
  expect(screen.queryByTestId("pdf-tool-options")).toBeNull();
  act(() => usePdfTool.getState().setTool(tabId, "ink"));
  const left = screen.getByTestId("pdf-dock-left");
  const rail = within(left).getByTestId("pdf-panel-tools");
  const options = within(left).getByTestId("pdf-tool-options");
  expect(options).toHaveClass("kern-pdf-options-column");
  expect(rail.contains(options)).toBe(false);
  expect(Boolean(rail.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
    true
  );
  setPanels(toggleCollapsed(movePanel(DEFAULT_PANELS, "tools", "right"), "tools"));
  const right = screen.getByTestId("pdf-dock-right");
  expect(
    Boolean(
      within(right)
        .getByTestId("pdf-tool-options")
        .compareDocumentPosition(within(right).getByTestId("pdf-panel-tools")) &
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  ).toBe(true);
});

test("a_bars_options_run_in_a_row_inside_its_panel_while_the_pen_is_in_hand", async () => {
  await dock();
  expect(screen.queryByTestId("pdf-tool-options")).toBeNull();
  act(() => usePdfTool.getState().setTool(tabId, "ink"));
  const tools = screen.getByTestId("pdf-panel-tools");
  expect(within(tools).getByTestId("pdf-tool-options")).toHaveClass("kern-pdf-options-row");
  act(() => usePdfTool.getState().setTool(tabId, "select"));
  expect(screen.queryByTestId("pdf-tool-options")).toBeNull();
});

test("the_pages_are_measured_once_for_the_pages_and_the_thumbnails", async () => {
  await dock();
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Page \d$/ })).toHaveLength(4));
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(4);
});

test("a_folded_tools_bar_keeps_only_the_chevron_and_opens_again_through_the_setting", async () => {
  await dock();
  fireEvent.click(screen.getByRole("button", { name: "Collapse Tools" }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-panel-tools")).toHaveAttribute("data-collapsed", "true")
  );
  expect(ipc.settingsSet).toHaveBeenCalledWith({
    pdf_panels: toggleCollapsed(DEFAULT_PANELS, "tools"),
  });
  const panel = screen.getByTestId("pdf-panel-tools");
  expect(within(panel).queryByTestId("pdf-tools")).toBeNull();
  expect(within(panel).queryByRole("heading")).toBeNull();
  expect(
    within(panel)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
  ).toEqual(["Expand Tools"]);
  fireEvent.click(screen.getByRole("button", { name: "Expand Tools" }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-panel-tools")).toHaveAttribute("data-collapsed", "false")
  );
});

test("a_folded_tools_rail_keeps_its_icons_with_the_chevron_in_the_header_and_the_move_menu_at_the_foot", async () => {
  await dock();
  setPanels(toggleCollapsed(movePanel(DEFAULT_PANELS, "tools", "right"), "tools"));
  const panel = screen.getByTestId("pdf-panel-tools");
  expect(within(panel).getByTestId("pdf-tools")).toHaveAttribute("data-form", "rail");
  expect(within(panel).queryByRole("heading")).toBeNull();
  const header = panel.querySelector("header") as HTMLElement;
  expect(
    within(header)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
  ).toEqual(["Expand Tools"]);
  const foot = panel.querySelector("footer") as HTMLElement;
  expect(within(foot).getByRole("button", { name: "Move Tools" })).toBeInTheDocument();
});

test("the_fold_chevron_is_the_last_button_in_every_expanded_header", async () => {
  await dock();
  for (const side of ["top", "left", "right", "bottom"] as const) {
    setPanels(movePanel(DEFAULT_PANELS, "tools", side));
    const header = screen.getByTestId("pdf-panel-tools").querySelector("header") as HTMLElement;
    const buttons = within(header).getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveAccessibleName("Collapse Tools");
    expect(buttons[0]).toHaveAccessibleName("Move Tools");
  }
  const thumbs = screen.getByTestId("pdf-panel-thumbnails").querySelector("header") as HTMLElement;
  const buttons = within(thumbs).getAllByRole("button");
  expect(buttons[buttons.length - 1]).toHaveAccessibleName("Collapse Thumbnails");
});

test("a_folded_thumbnail_strip_draws_nothing_and_keeps_its_side", async () => {
  await dock();
  setPanels(toggleCollapsed(DEFAULT_PANELS, "thumbnails"));
  const panel = screen.getByTestId("pdf-panel-thumbnails");
  expect(panel).toHaveAttribute("data-side", "left");
  expect(within(panel).queryByTestId("pdf-thumbs")).toBeNull();
  expect(within(panel).getByRole("button", { name: "Expand Thumbnails" })).toBeInTheDocument();
});

test("the_tools_move_menu_offers_the_top_and_the_thumbnails_one_does_not", async () => {
  await dock();
  fireEvent.click(screen.getByRole("button", { name: "Move Tools" }));
  const tools = await screen.findByRole("menu");
  expect(
    within(tools)
      .getAllByRole("menuitem")
      .map(
        (m) => (m.textContent ?? "").replace(/\s+/g, " ").trim().split(" to the ")[1]?.split(" ")[0]
      )
  ).toEqual(["top", "left", "right", "bottom"]);
  fireEvent.keyDown(tools, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Move Thumbnails" }));
  const thumbs = await screen.findByRole("menu");
  expect(within(thumbs).queryByRole("menuitem", { name: /to the top/ })).toBeNull();
  expect(within(thumbs).getAllByRole("menuitem")).toHaveLength(3);
});

test("the_move_menu_offers_each_side_and_moves_the_panel_there", async () => {
  await dock();
  fireEvent.click(screen.getByRole("button", { name: "Move Thumbnails" }));
  const menu = await screen.findByRole("menu");
  expect(
    within(menu).getByRole("menuitem", { name: /Move Thumbnails to the left/ })
  ).toBeDisabled();
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Move Thumbnails to the bottom/ }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-panel-thumbnails")).toHaveAttribute("data-side", "bottom")
  );
  expect(ipc.settingsSet).toHaveBeenCalledWith({
    pdf_panels: movePanel(DEFAULT_PANELS, "thumbnails", "bottom"),
  });
});

test("closing_the_document_drops_its_thumbnails_from_the_cache", async () => {
  thumbCache.set(thumbKey(3, 0, 0, THUMB_WIDTH), { width: 1, height: 1, bytes: new Uint8Array(4) });
  thumbCache.set(thumbKey(9, 0, 0, THUMB_WIDTH), { width: 1, height: 1, bytes: new Uint8Array(4) });
  const view = await dock();
  view.unmount();
  expect(thumbCache.get(thumbKey(3, 0, 0, THUMB_WIDTH))).toBeUndefined();
  expect(thumbCache.get(thumbKey(9, 0, 0, THUMB_WIDTH))).toBeDefined();
});
