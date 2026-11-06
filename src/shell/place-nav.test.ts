// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { useTabs } from "../store/tabs";
import { currentPlace, showFolder, shownFolder } from "./place-nav";

const p = (v: string): WirePath => ({ k: "Utf8", v });

test("only_the_most_specific_matching_place_is_current", () => {
  const places = [
    { key: "home", path: p("/home/t"), inside: false },
    { key: "docs", path: p("/home/t/Documents"), inside: false },
    { key: "vol-home", path: p("/home"), inside: true },
    { key: "vol-docs", path: p("/home/t/Documents"), inside: true },
  ];
  expect(currentPlace(p("/home/t/Documents"), places)).toBe("docs");
  expect(currentPlace(p("/home/t/Documents/x"), places)).toBe("vol-docs");
  expect(currentPlace(p("/home/t"), places)).toBe("home");
  expect(currentPlace(p("/home/u"), places)).toBe("vol-home");
  expect(currentPlace(p("/srv"), places)).toBeNull();
  expect(currentPlace(null, places)).toBeNull();
});

test("a_place_shown_from_the_trash_or_all_documents_brings_the_folder_tab_forward", () => {
  for (const open of ["openTrash", "openDocuments"] as const) {
    useTabs.setState({ tabs: [], activeId: null, lastFolderId: null });
    useTabs.getState().openFolder({ k: "Utf8", v: "/a" }, false);
    const folder = useTabs.getState().tabs[0]!;
    useTabs.getState()[open]();
    expect(shownFolder(useTabs.getState())).toBeNull();
    showFolder({ k: "Utf8", v: "/b" });
    const s = useTabs.getState();
    expect(s.activeId).toBe(folder.id);
    expect(s.tabs.find((t) => t.id === folder.id)).toMatchObject({ path: { v: "/b" } });
  }
});
