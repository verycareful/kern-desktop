// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { actions, currentContext, getAction, isEnabled, runAction } from "./actions";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});

test("tab_close_runs_on_the_target_tab_not_the_active_one", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id) as [string, string];
  expect(useTabs.getState().activeId).toBe(b);
  expect(runAction(getAction("tab.close"), currentContext(a))).toBe(true);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([b]);
  expect(useTabs.getState().activeId).toBe(b);
  // No target given: the active tab.
  runAction(getAction("tab.close"), currentContext());
  expect(useTabs.getState().tabs).toHaveLength(0);
});

test("every_action_has_an_area", () => {
  for (const a of actions) expect(a.area, a.id).toMatch(/\S/);
});

test("applicability_follows_the_target_tab", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openDoc(p("/a/n.md"));
  const [folder, doc] = useTabs.getState().tabs.map((t) => t.id) as [string, string];
  useTabs.getState().activate(folder);
  // Active is a folder tab, but the menu was opened on the document tab.
  expect(isEnabled(getAction("panel.left.toggle"), currentContext())).toBe(false);
  expect(isEnabled(getAction("panel.left.toggle"), currentContext(doc))).toBe(true);
});
