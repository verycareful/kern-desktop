// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { actions, type Action } from "../keys/actions";

const ipc = vi.hoisted(() => ({ openUrl: vi.fn(), settingsGet: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
import { WelcomePane } from "./WelcomePane";
import { WELCOME_ASKS, WELCOME_FACTS, WELCOME_ROTATION } from "./welcome-content";
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
  const fact = () => screen.getByTestId("welcome-fact").querySelector("p")?.textContent ?? "";
  const first = shown();
  expect(first).toContain(tips[0]!.label);
  expect(screen.getByTestId("welcome-tip").querySelector("kbd")).toHaveTextContent(tips[0]!.key);
  const firstFact = fact();
  act(() => void vi.advanceTimersByTime(ROTATE_MS));
  expect(shown()).toContain(tips[1]!.label);
  expect(fact()).not.toBe(firstFact);
  // By hand too.
  fireEvent.click(screen.getByRole("button", { name: "Another tip" }));
  expect(shown()).toContain(tips[2]!.label);
  // The last wraps to the first.
  for (let i = 0; i < tips.length; i++)
    fireEvent.click(screen.getByRole("button", { name: "Another tip" }));
  expect(shown()).toContain(tips[2]!.label);
});

test("every_fact_is_shown_once_before_any_comes_back_in_an_order_of_its_own", () => {
  const orderOf = () => {
    const seen: string[] = [];
    const view = render(<WelcomePane />);
    const fact = () => screen.getByTestId("welcome-fact").querySelector("p")?.textContent ?? "";
    for (let i = 0; i < WELCOME_ROTATION.length; i++) {
      seen.push(fact());
      fireEvent.click(screen.getByRole("button", { name: "Another fact" }));
    }
    // After the last, the round starts again with the first.
    expect(fact()).toBe(seen[0]);
    view.unmount();
    return seen;
  };
  const random = vi.spyOn(Math, "random");
  random.mockReturnValue(0);
  const one = orderOf();
  expect([...one].sort()).toEqual(WELCOME_ROTATION.map((f) => f.text).sort());
  random.mockReturnValue(0.999);
  const other = orderOf();
  expect(new Set(other).size).toBe(WELCOME_ROTATION.length);
  expect(other).not.toEqual(one);
  random.mockRestore();
});

test("a_pane_that_goes_stops_rotating", () => {
  const clear = vi.spyOn(globalThis, "clearInterval");
  const view = render(<WelcomePane />);
  view.unmount();
  expect(clear).toHaveBeenCalled();
});

// ---- the facts ----

test("welcome_facts_are_sentences_each_with_a_reference", () => {
  expect(WELCOME_FACTS.length).toBeGreaterThanOrEqual(50);
  for (const f of WELCOME_FACTS) {
    expect(f.text.endsWith("."), f.text).toBe(true);
    expect(f.source.trim(), f.text).not.toBe("");
  }
  expect(new Set(WELCOME_FACTS.map((f) => f.text)).size).toBe(WELCOME_FACTS.length);
});

test("the_facts_are_about_the_world_not_about_kern", () => {
  for (const f of WELCOME_FACTS) expect(f.text, f.text).not.toMatch(/\bkern\b/i);
});

// ---- the words from the author ----

/** Shows the rotation's items in their own order (no shuffle) and returns the pane. */
function inOrder() {
  // Math.random at 0.999 swaps nothing: index i is drawn as floor(0.999 * (i + 1)) = i.
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  render(<WelcomePane />);
}
const toAsk = (at: number) => {
  for (let i = 0; i < at; i++)
    fireEvent.click(screen.getByRole("button", { name: "Another fact" }));
};

test("a_word_from_the_author_takes_its_turn_among_the_facts_and_opens_its_page", async () => {
  vi.useRealTimers();
  ipc.settingsGet.mockResolvedValue({ terminal: null });
  ipc.openUrl.mockResolvedValue(undefined);
  inOrder();
  const card = screen.getByTestId("welcome-fact");
  expect(within(card).queryByRole("button", { name: WELCOME_ASKS[0]!.label })).toBeNull();
  toAsk(WELCOME_FACTS.length);
  expect(card).toHaveTextContent(WELCOME_ASKS[0]!.text);
  expect(within(card).getByRole("heading")).toHaveTextContent("From the author");
  fireEvent.click(within(card).getByRole("button", { name: WELCOME_ASKS[0]!.label }));
  await waitFor(() =>
    expect(ipc.openUrl).toHaveBeenCalledExactlyOnceWith(WELCOME_ASKS[0]!.url, undefined)
  );
  vi.restoreAllMocks();
});

test("a_page_that_cannot_be_opened_is_said_while_its_word_shows", async () => {
  vi.useRealTimers();
  ipc.settingsGet.mockResolvedValue({ terminal: null });
  ipc.openUrl.mockRejectedValue({ kind: "Open", message: "no browser", path: null });
  inOrder();
  toAsk(WELCOME_FACTS.length);
  fireEvent.click(screen.getByRole("button", { name: WELCOME_ASKS[0]!.label }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened: .*no browser/);
  fireEvent.click(screen.getByRole("button", { name: "Another fact" }));
  expect(screen.queryByRole("alert")).toBeNull();
  vi.restoreAllMocks();
});

test("the_words_name_the_author_s_github_pages", () => {
  expect(WELCOME_ASKS.map((a) => a.url)).toEqual([
    "https://github.com/verycareful/kern-desktop",
    "https://github.com/verycareful",
    "https://github.com/verycareful/kern",
    "https://github.com/verycareful?tab=repositories",
  ]);
});
