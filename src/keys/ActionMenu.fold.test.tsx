// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ActionMenu, type MenuSection } from "./ActionMenu";
import type { Action } from "./actions";
import { useBinds } from "./binds";

function act1(id: string, label: string, run: () => void = () => undefined, on = true): Action {
  return { id, label, area: "View", keys: [], when: "any", enabled: () => on, run };
}

function show(sections: MenuSection[], onClose = () => undefined) {
  render(<ActionMenu sections={sections} x={0} y={0} onClose={onClose} />);
}

const FOLD = "More";

beforeEach(() => {
  useBinds.setState({ loaded: true, overrides: {}, error: null });
});

test("a_folded_section_is_one_row_that_hides_its_actions_until_opened", () => {
  show([
    { actions: [act1("a.top", "Top")] },
    { title: FOLD, fold: true, actions: [act1("a.in", "Inside")] },
  ]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  expect(row).toHaveAttribute("aria-haspopup", "menu");
  expect(row).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("menuitem", { name: "Top" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Inside" })).toBeNull();
});

test("a_click_opens_the_submenu_and_an_entry_in_it_runs_and_closes_the_whole_menu", () => {
  const run = vi.fn();
  const close = vi.fn();
  show([{ title: FOLD, fold: true, actions: [act1("a.in", "Inside", run)] }], close);
  fireEvent.click(screen.getByRole("menuitem", { name: FOLD }));
  const sub = screen.getByRole("menu", { name: FOLD });
  expect(screen.getByRole("menuitem", { name: FOLD })).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(within(sub).getByRole("menuitem", { name: "Inside" }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

test("hovering_a_folded_row_opens_it_and_hovering_another_row_closes_it", () => {
  show([
    { actions: [act1("a.top", "Top")] },
    { title: FOLD, fold: true, actions: [act1("a.in", "Inside")] },
  ]);
  fireEvent.pointerEnter(screen.getByRole("menuitem", { name: FOLD }));
  expect(screen.getByRole("menuitem", { name: "Inside" })).toBeInTheDocument();
  fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Top" }));
  expect(screen.queryByRole("menuitem", { name: "Inside" })).toBeNull();
});

test("right_arrow_opens_the_submenu_with_focus_on_its_first_enabled_entry_and_left_arrow_returns", () => {
  show([
    {
      title: FOLD,
      fold: true,
      actions: [act1("a.off", "Off", undefined, false), act1("a.in", "Inside")],
    },
  ]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowRight" });
  expect(screen.getByRole("menuitem", { name: "Inside" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Inside" }), { key: "ArrowLeft" });
  expect(screen.queryByRole("menuitem", { name: "Inside" })).toBeNull();
  expect(row).toHaveFocus();
});

test("enter_on_a_folded_row_opens_it", () => {
  show([{ title: FOLD, fold: true, actions: [act1("a.in", "Inside")] }]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  row.focus();
  fireEvent.click(row, { detail: 0 });
  expect(screen.getByRole("menuitem", { name: "Inside" })).toHaveFocus();
});

test("escape_closes_the_submenu_first_and_the_menu_second", () => {
  const close = vi.fn();
  show([{ title: FOLD, fold: true, actions: [act1("a.in", "Inside")] }], close);
  const row = screen.getByRole("menuitem", { name: FOLD });
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menuitem", { name: "Inside" })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(row).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});

test("arrow_keys_stay_inside_the_menu_they_are_in", () => {
  show([
    { actions: [act1("a.top1", "Top1"), act1("a.top2", "Top2")] },
    { title: FOLD, fold: true, actions: [act1("a.in1", "In1"), act1("a.in2", "In2")] },
  ]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowRight" });
  const in1 = screen.getByRole("menuitem", { name: "In1" });
  const in2 = screen.getByRole("menuitem", { name: "In2" });
  expect(in1).toHaveFocus();
  fireEvent.keyDown(in1, { key: "ArrowDown" });
  expect(in2).toHaveFocus();
  fireEvent.keyDown(in2, { key: "ArrowDown" });
  expect(in1).toHaveFocus();
  // Back on the top level, Down skips the submenu's entries.
  fireEvent.keyDown(in1, { key: "ArrowLeft" });
  fireEvent.keyDown(row, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Top1" })).toHaveFocus();
});

test("a_folded_row_whose_actions_are_all_disabled_is_disabled", () => {
  show([{ title: FOLD, fold: true, actions: [act1("a.off", "Off", undefined, false)] }]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  expect(row).toBeDisabled();
  fireEvent.click(row);
  expect(screen.queryByRole("menuitem", { name: "Off" })).toBeNull();
});

test("a_section_marked_as_a_rule_gets_a_divider_above_it", () => {
  show([{ actions: [act1("a.one", "One")] }, { rule: true, actions: [act1("a.two", "Two")] }]);
  const one = screen
    .getByRole("menuitem", { name: "One" })
    .closest("ul[role=group]")!.parentElement!;
  const two = screen
    .getByRole("menuitem", { name: "Two" })
    .closest("ul[role=group]")!.parentElement!;
  expect(one).not.toHaveClass("kern-menu-rule");
  expect(two).toHaveClass("kern-menu-rule");
});

test("down_on_the_top_level_skips_a_submenu_the_pointer_left_open", () => {
  show([
    { actions: [act1("a.top1", "Top1")] },
    { title: FOLD, fold: true, actions: [act1("a.in1", "In1")] },
  ]);
  const row = screen.getByRole("menuitem", { name: FOLD });
  fireEvent.pointerEnter(row);
  expect(screen.getByRole("menuitem", { name: "In1" })).toBeInTheDocument();
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Top1" })).toHaveFocus();
});
