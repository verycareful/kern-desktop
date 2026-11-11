// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { FolderMenu } from "../ipc";
import type { MenuSection } from "../keys/ActionMenu";
import { actions, getAction, type Action } from "../keys/actions";

// The right-click menu of a folder tab is the folder actions of the table, grouped as the main menu
// groups them (keyboard and right-click parity).
const AREAS = ["Open", "Pinned", "Edit", "Create", "Selection", "View"] as const;
type Area = (typeof AREAS)[number];

const inArea = (area: Area): Action[] =>
  actions.filter((a) => a.when === "folder" && a.area === area);

// What the standard shape keeps on top, in groups that a divider separates: opening, the clipboard
// and removal, creating, and Properties.
const TOP: readonly (readonly string[])[] = [
  ["folder.open", "folder.openWith"],
  ["folder.cut", "folder.copy", "folder.paste", "folder.rename", "folder.trash"],
  ["folder.new.folder", "folder.new.file"],
  ["folder.properties"],
];
const TOP_IDS = new Set(TOP.flat());

// The folded groups follow this order, the more used first.
const FOLD_ORDER: readonly Area[] = ["Open", "Edit", "Create", "Pinned", "Selection", "View"];

// The submenu that holds what is left of a group once its top entries are taken out.
const FOLD_TITLES: Record<Area, string> = {
  Open: "More ways to open",
  Edit: "More edit actions",
  Pinned: "Pinned",
  Create: "Create",
  Selection: "Selection",
  View: "View",
};

/**
 * The sections of the folder view's context menu in the shape the user chose: `standard` puts the
 * most used actions on top and folds the rest of each group into a submenu, `collapsed` folds
 * every group, `expanded` lists every action at once under its group's title.
 */
export function folderMenu(shape: FolderMenu): MenuSection[] {
  if (shape === "expanded") {
    return AREAS.map((area) => ({ title: area, actions: inArea(area) }));
  }
  if (shape === "collapsed") {
    return AREAS.map((area) => ({ title: area, fold: true, actions: inArea(area) }));
  }
  const top: MenuSection[] = TOP.map((ids, n) => ({
    actions: ids.map(getAction),
    rule: n > 0,
  }));
  const folded: MenuSection[] = [];
  for (const area of FOLD_ORDER) {
    const rest = inArea(area).filter((a) => !TOP_IDS.has(a.id));
    if (rest.length === 0) continue;
    folded.push({ title: FOLD_TITLES[area], fold: true, actions: rest, rule: folded.length === 0 });
  }
  return [...top, ...folded];
}

/** Every action any shape of the menu lists. */
export function everyFolderAction(): Action[] {
  return AREAS.flatMap(inArea);
}
