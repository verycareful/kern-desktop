// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { File, Folder, X } from "lucide-react";
import { displayPath, parent, pathKey, type WirePath } from "../ipc";
import { ActionMenu } from "../keys/ActionMenu";
import { ITEM_DRAG_THRESHOLD } from "../ops/dnd";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { ENTRY_MENU } from "./entry-menu";
import { moveItem, usePinnedRecent, type EntryList } from "./pinned-recent-store";
import { homeRelative } from "./home-relative";
import { RELATIVE_TIME_TICK_MS, relativeTime } from "./relative-time";
import { useUserDirs } from "./user-dirs-store";

// Design 4.1 and 4.2: Pinned on top, Recent below, in the right third. A pin
// shows its parent folder and a recent entry when it was opened, so entries of
// the same name are told apart. A click opens the entry (a folder in the
// current folder tab, a file through the open command); right-click, the Menu
// key or Shift+F10 gives the entry's menu. Pins are reordered by dragging one
// along the list, or with Move up and Move down in its menu.

/** The attribute a pinned row carries: the path key of its pin. */
const PIN_ATTR = "data-pin";

/** Where a pin dragged to height `y` lands: the number of the other rows whose middle is above it. */
function slotAt(list: HTMLElement | null, dragged: string, y: number): number {
  let slot = 0;
  for (const row of list?.querySelectorAll<HTMLElement>(`[${PIN_ATTR}]`) ?? []) {
    if (row.getAttribute(PIN_ATTR) === dragged) continue;
    const r = row.getBoundingClientRect();
    if (r.top + r.height / 2 < y) slot++;
  }
  return slot;
}

/** The current time, worked out again every `tick` milliseconds. */
function useNow(tick: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), tick);
    return () => window.clearInterval(t);
  }, [tick]);
  return now;
}

export function PinnedRecentPanel(props: { overlay?: boolean }) {
  const s = usePinnedRecent();
  const home = useUserDirs((u) => u.dirs?.home ?? null);
  const now = useNow(RELATIVE_TIME_TICK_MS);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ key: string; slot: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void usePinnedRecent
      .getState()
      .follow()
      .then((off) => (live ? (stop = off) : off()));
    // The pins are shown with ~ for the home folder; a failed lookup shows them whole, and
    // the places strip, which reads the same store, shows the failure with Retry.
    useUserDirs
      .getState()
      .load()
      .catch(() => undefined);
    const again = () => void usePinnedRecent.getState().prune();
    window.addEventListener("focus", again);
    return () => {
      live = false;
      stop?.();
      window.removeEventListener("focus", again);
      stopDrag.current?.();
    };
  }, []);

  const openMenu = (
    listName: EntryList,
    path: WirePath,
    at: { x: number; y: number },
    button: HTMLElement
  ) => {
    s.setCurrent({ list: listName, path });
    button.focus();
    setMenu(at);
  };

  const menuHandlers = (listName: EntryList, path: WirePath) => ({
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      openMenu(listName, path, { x: e.clientX, y: e.clientY }, e.currentTarget);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(listName, path, { x: r.left, y: r.bottom }, e.currentTarget);
    },
  });

  // A press on a pin that travels ITEM_DRAG_THRESHOLD pixels drags it; letting go puts it
  // where the marker shows. The pin is named by its key, so a list that changes during the
  // drag (a pin added in another window) still moves the pin that was pressed.
  const onPinPointerDown = (key: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    stopDrag.current?.();
    const start = { x: e.clientX, y: e.clientY };
    let slot: number | null = null;
    const move = (m: PointerEvent) => {
      // No button held: the release was not seen (it happened outside the window), so the
      // drag ends where it is, with nothing moved.
      if (m.buttons === 0) {
        stop();
        return;
      }
      if (
        slot === null &&
        Math.hypot(m.clientX - start.x, m.clientY - start.y) < ITEM_DRAG_THRESHOLD
      )
        return;
      slot = slotAt(list.current, key, m.clientY);
      setDrag({ key, slot });
    };
    const up = () => {
      stop();
      if (slot === null) return;
      // The click that ends a press which travelled does not open the pin.
      const swallow = (c: Event) => c.stopPropagation();
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      const pins = usePinnedRecent.getState().pins ?? [];
      const from = pins.findIndex((p) => pathKey(p) === key);
      if (from < 0) {
        usePinnedRecent
          .getState()
          .notify("The pin was removed while it was dragged, so nothing was moved.");
      } else if (from !== slot) {
        void usePinnedRecent.getState().reorder(moveItem(pins, from, slot));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      stopDrag.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    stopDrag.current = stop;
  };

  /** The full path, and why its icon may be wrong when its kind could not be looked up. */
  const title = (path: WirePath) => {
    const why = s.kindErrors[pathKey(path)];
    return why ? `${displayPath(path)} (its type could not be read: ${why})` : displayPath(path);
  };

  const pins = s.pins ?? [];
  const others = drag ? pins.filter((p) => pathKey(p) !== drag.key) : [];
  /** The class that draws the drop marker on a row, while a pin is dragged. */
  const marker = (key: string): string => {
    if (!drag || key === drag.key) return "";
    const i = others.findIndex((p) => pathKey(p) === key);
    if (i === drag.slot) return " kern-insert-before";
    return i === others.length - 1 && drag.slot === others.length ? " kern-insert-after" : "";
  };
  const icon = (path: WirePath) =>
    s.kinds[pathKey(path)] === "folder" ? (
      <Folder size={16} strokeWidth={2} aria-hidden />
    ) : (
      <File size={16} strokeWidth={2} aria-hidden />
    );

  return (
    <aside
      className={
        props.overlay ? "kern-panel kern-panel-right kern-overlay" : "kern-panel kern-panel-right"
      }
      aria-label="Pinned and Recent"
      data-testid="side-panel"
    >
      {(s.loadError || s.notices.length > 0) && (
        <div className="kern-side-notices">
          {s.loadError && (
            <div role="alert" className="kern-places-error">
              <span>Pinned and Recent could not be read: {errorText(s.loadError)}</span>
              <button
                type="button"
                className="kern-button"
                onClick={() => void usePinnedRecent.getState().prune()}
              >
                Retry
              </button>
            </div>
          )}
          {s.notices.map((n) => (
            <div key={n.id} role="alert" className="kern-places-error">
              <span>{n.text}</span>
              <button
                type="button"
                className="kern-icon-button"
                aria-label="Dismiss"
                onClick={() => s.dismiss(n.id)}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <section className="kern-side-section" aria-labelledby="kern-pinned" data-testid="pinned">
        <h2 id="kern-pinned" className="kern-label">
          Pinned
        </h2>
        {s.pins?.length === 0 && (
          <p className="kern-places-none">Nothing pinned. Select items and press Ctrl+D.</p>
        )}
        <ul ref={list} className="kern-places-list kern-pins">
          {pins.map((p) => {
            const key = pathKey(p);
            const where = parent(p);
            const name = baseName(p);
            return (
              <li
                key={key}
                {...{ [PIN_ATTR]: key }}
                className={`kern-entry${drag?.key === key ? " kern-entry-dragged" : ""}${marker(key)}`}
              >
                <button
                  type="button"
                  className="kern-place"
                  title={title(p)}
                  onClick={() => void s.open(p)}
                  onPointerDown={onPinPointerDown(key)}
                  {...menuHandlers("pinned", p)}
                >
                  {icon(p)}
                  <span className="kern-place-label">{name}</span>
                  {where && <span className="kern-entry-note">{homeRelative(where, home)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="kern-side-section" aria-labelledby="kern-recent" data-testid="recent">
        <h2 id="kern-recent" className="kern-label">
          Recent
        </h2>
        {s.recents?.length === 0 && <p className="kern-places-none">No recent files.</p>}
        <ul className="kern-places-list">
          {(s.recents ?? []).map((r) => (
            <li key={pathKey(r.path)} className="kern-entry">
              <button
                type="button"
                className="kern-place"
                title={title(r.path)}
                onClick={() => void s.open(r.path)}
                {...menuHandlers("recent", r.path)}
              >
                {icon(r.path)}
                <span className="kern-place-label">{baseName(r.path)}</span>
                <span className="kern-entry-note">{relativeTime(r.opened_ms, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {menu && (
        <ActionMenu
          sections={ENTRY_MENU}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            s.setCurrent(null);
          }}
        />
      )}
    </aside>
  );
}
