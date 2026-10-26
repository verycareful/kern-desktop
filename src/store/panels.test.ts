// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { panelVisibility, usePanelsStore } from "./panels";
import { activeTab, useTabs } from "./tabs";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const vis = () => panelVisibility(activeTab(useTabs.getState()), usePanelsStore.getState());

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});

test("doc_tab_folds_both", () => {
  useTabs.getState().openFolder(p("/a"), false);
  expect(vis()).toEqual({ leftOpen: true, rightOpen: true });
  useTabs.getState().openDoc(p("/a/n.md"));
  expect(vis()).toEqual({ leftOpen: false, rightOpen: false });
  usePanelsStore.getState().toggleLeft();
  expect(vis()).toEqual({ leftOpen: true, rightOpen: false });
  usePanelsStore.getState().toggleRight();
  usePanelsStore.getState().toggleLeft();
  expect(vis()).toEqual({ leftOpen: false, rightOpen: true });
});

test("toggle_resets_on_tab_change", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openDoc(p("/a/n.md"));
  const doc = useTabs.getState().activeId!;
  usePanelsStore.getState().toggleLeft();
  usePanelsStore.getState().toggleRight();
  useTabs.getState().openDoc(p("/a/m.md"));
  expect(vis()).toEqual({ leftOpen: false, rightOpen: false });
  usePanelsStore.getState().toggleLeft();
  useTabs.getState().activate(doc);
  expect(vis()).toEqual({ leftOpen: false, rightOpen: false });
});
