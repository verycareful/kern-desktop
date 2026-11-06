// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MenuSection } from "../keys/ActionMenu";
import { actions } from "../keys/actions";

/** The volume's own menu: where the volume actions are, with the Menu key and Shift+F10 as well as right-click. */
export const VOLUME_MENU: MenuSection[] = [
  {
    title: "Volume",
    actions: ["volume.unmount", "volume.eject", "volume.mount"].map((id) =>
      actions.find((a) => a.id === id)!
    ),
  },
];
