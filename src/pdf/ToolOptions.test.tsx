// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { PALETTE, INK_WIDTHS } from "./annotations";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool } from "./pdf-tool";
import { ToolOptions } from "./ToolOptions";

const tabId = "tab-1";
beforeEach(() => {
  usePdfSelection.setState({ byTab: {}, searches: {} });
  usePdfTool.setState({ byTab: {}, listed: {} });
});

const holdPen = () => act(() => usePdfTool.getState().setTool(tabId, "ink"));

test("nothing_is_drawn_while_the_pen_is_not_in_hand_and_no_text_is_selected", () => {
  const { container } = render(<ToolOptions tabId={tabId} layout="row" />);
  expect(container).toBeEmptyDOMElement();
});

test("a_swatch_and_a_width_set_the_colour_and_the_width_of_the_tab", () => {
  render(<ToolOptions tabId={tabId} layout="row" />);
  holdPen();
  for (const swatch of PALETTE) {
    fireEvent.click(screen.getByRole("button", { name: `Colour ${swatch.name}` }));
    expect(usePdfTool.getState().byTab[tabId]?.colour).toEqual(swatch.rgb);
  }
  for (const w of INK_WIDTHS) {
    fireEvent.click(screen.getByRole("button", { name: `Pen width ${w} points` }));
    expect(usePdfTool.getState().byTab[tabId]?.inkWidth).toBe(w);
    expect(screen.getByRole("button", { name: `Pen width ${w} points` })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
});

test("the_swatches_are_the_document_colours_whatever_the_theme", () => {
  render(<ToolOptions tabId={tabId} layout="row" />);
  holdPen();
  for (const swatch of PALETTE) {
    const button = screen.getByRole("button", { name: `Colour ${swatch.name}` });
    expect(button.style.background).not.toContain("var(");
    expect(button.style.background).not.toBe("");
  }
});

test("selected_text_alone_offers_the_colours_and_no_widths", () => {
  render(<ToolOptions tabId={tabId} layout="row" />);
  act(() =>
    usePdfSelection
      .getState()
      .select(tabId, { page: 0, from: { line: 0, unit: 0 }, to: { line: 0, unit: 2 } })
  );
  expect(screen.getAllByRole("button", { name: /^Colour / })).toHaveLength(PALETTE.length);
  expect(screen.queryByRole("button", { name: /^Pen width / })).toBeNull();
  expect(screen.getByRole("group", { name: "Colour" })).toBeInTheDocument();
});

test("a_row_names_its_sets_and_a_column_does_not", () => {
  const row = render(<ToolOptions tabId={tabId} layout="row" />);
  holdPen();
  expect(row.container.querySelectorAll(".kern-pdf-options-caption")).toHaveLength(2);
  expect(screen.getByText("Pen")).toBeInTheDocument();
  expect(screen.getByText("Width")).toBeInTheDocument();
  row.unmount();
  const column = render(<ToolOptions tabId={tabId} layout="column" />);
  expect(column.container.querySelectorAll(".kern-pdf-options-caption")).toHaveLength(0);
  expect(screen.getByTestId("pdf-tool-options")).toHaveClass("kern-pdf-options-column");
});

test("inline_options_are_brought_into_view_when_they_appear", () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-testid") ?? "");
  };
  try {
    render(<ToolOptions tabId={tabId} layout="inline" />);
    expect(scrolled).toEqual([]);
    holdPen();
    expect(scrolled).toEqual(["pdf-tool-options"]);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
