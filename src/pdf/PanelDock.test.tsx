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

test("by_default_thumbnails_stand_left_of_the_pages_and_tools_right", async () => {
  await dock();
  const left = screen.getByTestId("pdf-dock-left");
  const right = screen.getByTestId("pdf-dock-right");
  expect(within(left).getByTestId("pdf-panel-thumbnails")).toBeInTheDocument();
  expect(within(right).getByTestId("pdf-panel-tools")).toBeInTheDocument();
  expect(screen.queryByTestId("pdf-dock-bottom")).toBeNull();
  const follows = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const pages = screen.getByTestId("pdf-scroll");
  expect(follows(left, pages)).toBe(true);
  expect(follows(pages, right)).toBe(true);
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

test("both_panels_on_one_side_stack_thumbnails_first", async () => {
  await dock();
  setPanels(movePanel(DEFAULT_PANELS, "tools", "left"));
  const left = screen.getByTestId("pdf-dock-left");
  const panels = within(left).getAllByRole("complementary");
  expect(panels.map((a) => a.getAttribute("data-testid"))).toEqual([
    "pdf-panel-thumbnails",
    "pdf-panel-tools",
  ]);
});

test("the_pages_are_measured_once_for_the_pages_and_the_thumbnails", async () => {
  await dock();
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Page \d$/ })).toHaveLength(4));
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(4);
});

test("the_fold_button_folds_a_panel_to_its_icons_and_opens_it_again_through_the_setting", async () => {
  await dock();
  fireEvent.click(screen.getByRole("button", { name: "Collapse Tools" }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-panel-tools")).toHaveAttribute("data-collapsed", "true")
  );
  expect(ipc.settingsSet).toHaveBeenCalledWith({
    pdf_panels: toggleCollapsed(DEFAULT_PANELS, "tools"),
  });
  // Folded, the tools keep their icons and the title and the move menu are gone.
  expect(within(screen.getByTestId("pdf-panel-tools")).queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "Move Tools" })).toBeNull();
  expect(
    within(screen.getByTestId("pdf-panel-tools")).getAllByRole("button").length
  ).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("button", { name: "Expand Tools" }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-panel-tools")).toHaveAttribute("data-collapsed", "false")
  );
});

test("a_folded_thumbnail_strip_draws_nothing_and_keeps_its_side", async () => {
  await dock();
  setPanels(toggleCollapsed(DEFAULT_PANELS, "thumbnails"));
  const panel = screen.getByTestId("pdf-panel-thumbnails");
  expect(panel).toHaveAttribute("data-side", "left");
  expect(within(panel).queryByTestId("pdf-thumbs")).toBeNull();
  expect(within(panel).getByRole("button", { name: "Expand Thumbnails" })).toBeInTheDocument();
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
