// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MenuSection } from "../keys/ActionMenu";
import { getAction } from "../keys/actions";

/** The menu of an entry of Pinned or Recent, with the Menu key and Shift+F10 as well as right-click. */
export const ENTRY_MENU: MenuSection[] = [
  {
    title: "Pinned",
    actions: ["entry.open", "entry.pin", "entry.unpin", "entry.up", "entry.down"].map(getAction),
  },
];
