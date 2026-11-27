// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import type { WireEntry } from "../ipc";
import { ActionMenu } from "../keys/ActionMenu";
import { hitMenu } from "./hit-menu";
import { useHitMenu } from "./hit-menu-store";
import { OpenWithDialog } from "./OpenWithDialog";

// The menu of a hit of a search or of the Library, with the Menu key and Shift+F10 as well as
// right-click, and the Open with dialog it can ask for, which stays after the menu has closed.

interface MenuAt {
  entry: WireEntry;
  x: number;
  y: number;
}

/** True for the keys that open the menu of the focused item. */
export const isMenuKey = (e: React.KeyboardEvent): boolean =>
  e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/**
 * The state of a view's hit menu. `show` aims the hit actions at the entry before the menu is
 * drawn, so the menu's first drawing already knows what they are aimed at.
 */
export function useHitMenuState(onOpen: (entry: WireEntry, newWindow: boolean) => void) {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [choosing, setChoosing] = useState<WireEntry | null>(null);
  const show = (entry: WireEntry, x: number, y: number) => {
    useHitMenu.getState().setCurrent({ entry, open: onOpen, openWith: setChoosing });
    setMenu({ entry, x, y });
  };
  const close = () => {
    useHitMenu.getState().setCurrent(null);
    setMenu(null);
  };
  const element = (
    <>
      {menu && <ActionMenu sections={hitMenu(menu.entry)} x={menu.x} y={menu.y} onClose={close} />}
      {choosing && <OpenWithDialog entry={choosing} onClose={() => setChoosing(null)} />}
    </>
  );
  return { show, element };
}
