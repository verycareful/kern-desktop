// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect } from "react";
import {
  Download,
  FileText,
  House,
  Folder,
  Image,
  Monitor,
  Music,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { WirePath } from "../ipc";
import { DROP_TARGET_ATTR, dropTargetValue } from "../ops/dnd";
import { showFolder } from "./place-nav";
import { placeKey, useCurrentPlace } from "./use-current-place";
import { useUserDirs } from "./user-dirs-store";

// Design 4.1: the Places group of the strip. Home first, then the user's
// folders that exist (user_dirs lists only those): Documents, Downloads and
// Desktop as the design names them, then the rest in the order the backend
// gives. A place shows its folder in the current folder tab (place-nav.ts)
// and is marked while that folder is the one on show.

interface Place {
  key: string;
  label: string;
  path: WirePath;
  Icon: LucideIcon;
}

/** The XDG names (xdg-user-dirs) and how each appears. */
const KNOWN: Record<string, { label: string; Icon: LucideIcon }> = {
  documents: { label: "Documents", Icon: FileText },
  download: { label: "Downloads", Icon: Download },
  desktop: { label: "Desktop", Icon: Monitor },
  music: { label: "Music", Icon: Music },
  pictures: { label: "Pictures", Icon: Image },
  videos: { label: "Videos", Icon: Video },
};
const FIRST = ["documents", "download", "desktop"];

function order(home: WirePath, dirs: { name: string; path: WirePath }[]): Place[] {
  const rank = (name: string) => {
    const i = FIRST.indexOf(name);
    return i < 0 ? FIRST.length : i;
  };
  // A stable sort: names of equal rank (the rest) keep the backend's order.
  const sorted = [...dirs].sort((a, b) => rank(a.name) - rank(b.name));
  return [
    { key: "home", label: "Home", path: home, Icon: House },
    ...sorted.map((d) => ({
      key: d.name,
      label: KNOWN[d.name]?.label ?? d.name.charAt(0).toUpperCase() + d.name.slice(1),
      path: d.path,
      Icon: KNOWN[d.name]?.Icon ?? Folder,
    })),
  ];
}

export function PlacesList() {
  const dirs = useUserDirs((s) => s.dirs);
  const error = useUserDirs((s) => s.error);
  const current = useCurrentPlace();
  const places = dirs ? order(dirs.home, dirs.dirs) : [];
  const load = useCallback(() => {
    // A failure is kept in the store, which is where it is shown from.
    useUserDirs
      .getState()
      .load()
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const again = () =>
      void useUserDirs
        .getState()
        .refresh()
        .catch(() => undefined);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);

  return (
    <section className="kern-places-group" aria-label="Places">
      <h2 className="kern-label kern-places-heading">Places</h2>
      {error && (
        <div role="alert" className="kern-places-error">
          <span>
            The places could not be {dirs ? "read again" : "listed"}: {error.kind}: {error.message}
          </span>{" "}
          <button
            type="button"
            className="kern-button"
            onClick={() =>
              void useUserDirs
                .getState()
                .refresh()
                .catch(() => undefined)
            }
          >
            Retry
          </button>
        </div>
      )}
      <ul className="kern-places-list">
        {places.map(({ key, label, path, Icon }) => (
          <li key={key} {...{ [DROP_TARGET_ATTR]: dropTargetValue(path) }}>
            <button
              type="button"
              className="kern-place"
              aria-current={current === placeKey(key) ? "page" : undefined}
              title={label}
              onClick={() => showFolder(path)}
            >
              <Icon size={16} strokeWidth={2} aria-hidden />
              <span className="kern-place-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
