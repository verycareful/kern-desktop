// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MenuSection } from "../keys/ActionMenu";
import { getAction, type Action } from "../keys/actions";
import { opensAsEditor, usePinnedRecent } from "./pinned-recent-store";

const EDIT = ["entry.copyPath", "entry.properties"];
const PINNED = [
  "entry.pin",
  "entry.unpin",
  "entry.pinEditor",
  "entry.up",
  "entry.down",
  "entry.forget",
];

/**
 * The menu of the entry of Pinned or Recent it is opened on, with the Menu key and Shift+F10 as
 * well as right-click. An entry whose Open opens an editor window (a pin marked as an editor, a
 * recent folder that was open as one) offers its folder tab instead of a second way to the
 * editor; any other entry offers the editor.
 */
export function entryMenu(): MenuSection[] {
  const s = usePinnedRecent.getState();
  const editor = s.current !== null && opensAsEditor(s, s.current.list, s.current.path);
  const other = editor ? "entry.openInFileManager" : "entry.openAsEditor";
  return [
    { title: "Open", actions: ["entry.open", "entry.location", other].map(getAction) },
    { title: "Edit", actions: EDIT.map(getAction) },
    { title: "Pinned", actions: PINNED.map(getAction) },
  ];
}

/** Every action any form of the entry menu lists. */
export function everyEntryAction(): Action[] {
  const open = ["entry.open", "entry.location", "entry.openAsEditor", "entry.openInFileManager"];
  return [...open, ...EDIT, ...PINNED].map(getAction);
}
