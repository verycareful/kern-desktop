import type { WirePath } from "../ipc";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { currentContext, getAction, runAction } from "./actions";

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
  for (const id of ["tab.close", "nav.up", "panel.left.toggle"]) {
    expect(getAction(id).area).toMatch(/\S/);
  }
});
