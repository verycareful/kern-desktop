// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { actions, type Action } from "../keys/actions";
import { WelcomePane } from "./WelcomePane";
import { WELCOME_FACTS } from "./welcome-content";
import { ROTATE_MS, tipsFromActions } from "./welcome-tips";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fake = (over: Partial<Action>): Action => ({
  id: "fake",
  label: "Fake",
  area: "File",
  keys: [],
  when: "any",
  run: () => undefined,
  ...over,
});

test("tips_come_from_actions_table", () => {
  const tips = tipsFromActions();
  expect(tips.length).toBeGreaterThan(5);
  // Every tip is an action of the table with that very key.
  for (const t of tips) {
    const a = actions.find((x) => x.id === t.id);
    expect(a, t.id).toBeDefined();
    expect(a!.keys, t.id).toContain(t.key);
    expect(t.label).toBe(a!.label);
  }
  // Save and the layout toggle are in the table, so they are tips, with the keys the table gives.
  expect(tips).toContainEqual({ id: "doc.save", label: "Save", key: "Ctrl+S" });
  expect(tips).toContainEqual(expect.objectContaining({ id: "layout.left.toggle", key: "Ctrl+B" }));
  // Nothing is listed that the table does not hold: a new action brings a tip, a key that moves moves.
  const added = fake({ id: "x.new", label: "Do the new thing", keys: ["Ctrl+Alt+9"] });
  expect(tipsFromActions([...actions, added])).toContainEqual({
    id: "x.new",
    label: "Do the new thing",
    key: "Ctrl+Alt+9",
  });
  const moved = actions.map((a) => (a.id === "doc.save" ? { ...a, keys: ["Ctrl+Alt+S"] } : a));
  expect(tipsFromActions(moved)).toContainEqual({
    id: "doc.save",
    label: "Save",
    key: "Ctrl+Alt+S",
  });
  expect(tipsFromActions(moved).some((t) => t.key === "Ctrl+S")).toBe(false);
});

test("movement_keys_and_other_lists_are_not_tips", () => {
  const list = [
    fake({ id: "a", keys: ["ArrowDown"], label: "Down" }),
    fake({ id: "b", keys: ["Delete"], label: "Del" }),
    fake({ id: "c", keys: ["Ctrl+X"], when: "trash", label: "Trash only" }),
    fake({ id: "d", keys: ["Ctrl+Q"], label: "Quit" }),
    fake({ id: "e", keys: ["Ctrl+Q"], label: "Quit again" }),
    fake({ id: "f", keys: ["Enter", "F2"], label: "Rename" }),
  ];
  expect(tipsFromActions(list)).toEqual([
    { id: "d", label: "Quit", key: "Ctrl+Q" },
    { id: "f", label: "Rename", key: "F2" },
  ]);
});

test("the_pane_shows_a_tip_and_a_fact_and_rotates_them", () => {
  render(<WelcomePane />);
  const tips = tipsFromActions();
  const shown = () => screen.getByTestId("welcome-tip").textContent ?? "";
  const first = shown();
  expect(first).toContain(tips[0]!.label);
  expect(screen.getByTestId("welcome-tip").querySelector("kbd")).toHaveTextContent(tips[0]!.key);
  expect(screen.getByTestId("welcome-fact")).toHaveTextContent(WELCOME_FACTS[0]!.text);
  act(() => void vi.advanceTimersByTime(ROTATE_MS));
  expect(shown()).toContain(tips[1]!.label);
  expect(screen.getByTestId("welcome-fact")).toHaveTextContent(WELCOME_FACTS[1]!.text);
  // By hand too.
  fireEvent.click(screen.getByRole("button", { name: "Another tip" }));
  expect(shown()).toContain(tips[2]!.label);
  fireEvent.click(screen.getByRole("button", { name: "Another fact" }));
  expect(screen.getByTestId("welcome-fact")).toHaveTextContent(WELCOME_FACTS[2]!.text);
  // The last wraps to the first.
  for (let i = 0; i < tips.length; i++)
    fireEvent.click(screen.getByRole("button", { name: "Another tip" }));
  expect(shown()).toContain(tips[2]!.label);
});

test("a_pane_that_goes_stops_rotating", () => {
  const clear = vi.spyOn(globalThis, "clearInterval");
  const view = render(<WelcomePane />);
  view.unmount();
  expect(clear).toHaveBeenCalled();
});

// ---- the facts ----

test("welcome_facts_each_name_a_source_that_holds_their_symbol", () => {
  expect(WELCOME_FACTS.length).toBeGreaterThanOrEqual(5);
  for (const f of WELCOME_FACTS) {
    const text = readFileSync(resolve(process.cwd(), f.source), "utf8");
    expect(text, `${f.source} should contain ${f.symbol}`).toContain(f.symbol);
  }
});

test("welcome_facts_carry_no_version_and_do_not_speak_of_other_software", () => {
  for (const f of WELCOME_FACTS) {
    expect(f.text, f.text).not.toMatch(/\d+\.\d+/);
    expect(f.text, f.text).not.toMatch(/\b(VS ?Code|Dolphin|Thunar|Nautilus|Vim|Emacs|Qyra)\b/i);
    expect(f.text.endsWith("."), f.text).toBe(true);
  }
  expect(new Set(WELCOME_FACTS.map((f) => f.text)).size).toBe(WELCOME_FACTS.length);
});

test("the_facts_name_files_that_are_tracked_by_the_repository", () => {
  // A source is a file of this repository, never a local or ignored one (CLAUDE.md, local/, tools/).
  for (const f of WELCOME_FACTS) {
    expect(f.source).toMatch(/^(src|src-tauri|scripts)\//);
    expect(f.source).not.toMatch(/^(local|tools)\//);
  }
});
