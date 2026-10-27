// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useTabs } from "../store/tabs";
import { currentPlace, shownFolder, type PlaceCandidate } from "./place-nav";
import { useUserDirs } from "./user-dirs-store";
import { mountedKey, useVolumes } from "./volumes-store";

/** Key of a user-folder place in the strip ("home", or the xdg name). */
export const placeKey = (name: string) => `place:${name}`;

/** The key of the one place or volume the strip marks as current (place-nav.ts currentPlace). */
export function useCurrentPlace(): string | null {
  const shown = useTabs((s) => shownFolder(s));
  const dirs = useUserDirs((s) => s.dirs);
  const mounted = useVolumes((s) => s.mounted);
  const candidates: PlaceCandidate[] = [
    ...(dirs
      ? [
          { key: placeKey("home"), path: dirs.home, inside: false },
          ...dirs.dirs.map((d) => ({ key: placeKey(d.name), path: d.path, inside: false })),
        ]
      : []),
    ...mounted.map((m) => ({ key: mountedKey(m), path: m.mount_point, inside: true })),
  ];
  return currentPlace(shown, candidates);
}
