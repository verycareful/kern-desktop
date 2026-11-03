// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MenuSection } from "../keys/ActionMenu";
import { actions } from "../keys/actions";

/** The right-click menu of the folder tree: the actions aimed at the entry it was opened on. */
export const TREE_MENU: MenuSection[] = [{ actions: actions.filter((a) => a.when === "tree") }];
