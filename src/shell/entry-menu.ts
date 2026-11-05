// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MenuSection } from "../keys/ActionMenu";
import { getAction } from "../keys/actions";

/** The menu of an entry of Pinned or Recent, with the Menu key and Shift+F10 as well as right-click. */
export const ENTRY_MENU: MenuSection[] = [
  {
    title: "Open",
    actions: ["entry.open", "entry.location", "entry.openAsEditor"].map(getAction),
  },
  {
    title: "Edit",
    actions: ["entry.copyPath", "entry.properties"].map(getAction),
  },
  {
    title: "Pinned",
    actions: [
      "entry.pin",
      "entry.unpin",
      "entry.pinEditor",
      "entry.up",
      "entry.down",
      "entry.forget",
    ].map(getAction),
  },
];
