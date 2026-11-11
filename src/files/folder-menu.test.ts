// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { actions } from "../keys/actions";
import { everyFolderAction, folderMenu } from "./folder-menu";

const ids = (sections: { actions: { id: string }[] }[]) =>
  sections.flatMap((s) => s.actions.map((a) => a.id));

const folderActions = () =>
  actions.filter(
    (a) =>
      a.when === "folder" &&
      ["Open", "Pinned", "Edit", "Create", "Selection", "View"].includes(a.area)
  );

test("every_shape_offers_the_same_actions_once_each", () => {
  const want = folderActions()
    .map((a) => a.id)
    .sort();
  expect(want.length).toBeGreaterThan(20);
  for (const mode of ["standard", "collapsed", "expanded"] as const) {
    expect(ids(folderMenu(mode)).sort(), mode).toEqual(want);
  }
  expect(
    everyFolderAction()
      .map((a) => a.id)
      .sort()
  ).toEqual(want);
});

test("expanded_lists_every_group_with_its_title_and_folds_none", () => {
  const sections = folderMenu("expanded");
  expect(sections.map((s) => s.title)).toEqual([
    "Open",
    "Pinned",
    "Edit",
    "Create",
    "Selection",
    "View",
  ]);
  expect(sections.some((s) => s.fold)).toBe(false);
});

test("collapsed_folds_every_group", () => {
  const sections = folderMenu("collapsed");
  expect(sections.map((s) => s.title)).toEqual([
    "Open",
    "Pinned",
    "Edit",
    "Create",
    "Selection",
    "View",
  ]);
  expect(sections.every((s) => s.fold)).toBe(true);
});

test("standard_keeps_the_most_used_on_top_and_folds_the_rest", () => {
  const sections = folderMenu("standard");
  const top = sections.filter((s) => !s.fold);
  const folded = sections.filter((s) => s.fold);
  expect(ids(top)).toEqual([
    "folder.open",
    "folder.openWith",
    "folder.cut",
    "folder.copy",
    "folder.paste",
    "folder.rename",
    "folder.trash",
    "folder.new.folder",
    "folder.new.file",
    "folder.properties",
  ]);
  expect(folded.map((s) => s.title)).toEqual([
    "More ways to open",
    "More edit actions",
    "Pinned",
    "Selection",
    "View",
  ]);
  // The top groups come before the folded ones, with a divider between each.
  expect(sections.slice(0, top.length).every((s) => !s.fold)).toBe(true);
  expect(top.slice(1).every((s) => s.rule)).toBe(true);
  expect(folded[0]?.rule).toBe(true);
});

test("standard_folds_what_the_top_does_not_hold_of_open_and_edit", () => {
  const folded = folderMenu("standard").filter((s) => s.fold);
  expect(ids([folded[0]!])).toEqual(
    expect.arrayContaining(["folder.openNewWindow", "folder.openAsEditor", "folder.terminal"])
  );
  expect(ids([folded[1]!])).toEqual(
    expect.arrayContaining(["folder.copyPath", "folder.undo", "folder.redo", "folder.delete"])
  );
});
