// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDocStatus } from "../editor/doc-status";
import { currentContext, isEnabled, runAction, type Action } from "./actions";
import { bindLabel, bindsOf, useBinds } from "./binds";
import { clampToViewport, submenuPosition } from "./menu-position";
import "./action-menu.css";

/**
 * A group of actions. With a title it is headed by it. `fold` shows the group as one row that
 * opens its actions in a submenu beside it, named by the title. `rule` draws a divider above the
 * group.
 */
export type MenuSection = { title?: string; actions: Action[]; fold?: boolean; rule?: boolean };

/** The enabled entries of one menu level: a submenu's entries are not the menu's own. */
function levelItems(menu: Element | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter(
    (b) => b.closest("[role=menu]") === menu
  );
}

/**
 * A menu over the action table: label, shortcut, greyed when the action
 * cannot run now. Up, Down, Home and End move between entries; Escape or an
 * outside press closes it and focus goes back to where it was. Actions run
 * aimed at `targetId` (see ActionContext.target).
 *
 * A folded section is a row with an arrow. Hovering it, clicking it or pressing Right opens its
 * submenu; Left or Escape closes the submenu and leaves the menu open, a second Escape closes
 * the menu.
 */
export function ActionMenu(props: {
  sections: MenuSection[];
  x: number;
  y: number;
  targetId?: string;
  onClose(): void;
}) {
  const { sections, targetId } = props;
  // The bind each entry shows is the user's, so the menu redraws when they change them.
  const overrides = useBinds((s) => s.overrides);
  // The caller may pass a new callback on every render; the listeners below must not re-run for that.
  const onClose = useRef(props.onClose);
  useLayoutEffect(() => {
    onClose.current = props.onClose;
  });
  const ref = useRef<HTMLUListElement>(null);
  const opener = useRef(document.activeElement);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  // The section whose submenu is open, its position, and whether the next opening takes focus.
  const [open, setOpen] = useState<number | null>(null);
  const [subPos, setSubPos] = useState({ x: 0, y: 0 });
  const openNow = useRef<number | null>(null);
  const focusFirst = useRef(false);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const sub = useRef<HTMLUListElement>(null);
  // A document becoming busy changes what an open menu may offer (Move to new window).
  useDocStatus((s) => s.byTab);
  const ctx = currentContext(targetId);

  const openSub = (n: number, takeFocus: boolean) => {
    focusFirst.current = takeFocus;
    openNow.current = n;
    setOpen(n);
  };
  const closeSub = (returnFocus: boolean) => {
    const n = openNow.current;
    if (n === null) return;
    openNow.current = null;
    setOpen(null);
    if (returnFocus) rows.current.get(n)?.focus();
  };
  // The window listeners below are set once and reach the submenu through this.
  const closeSubRef = useRef(closeSub);
  closeSubRef.current = closeSub;

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos(
      clampToViewport(
        props.x,
        props.y,
        { w: box.width, h: box.height },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }, [props.x, props.y]);

  useLayoutEffect(() => {
    if (open === null) return;
    const row = rows.current.get(open)?.getBoundingClientRect();
    const box = sub.current?.getBoundingClientRect();
    if (row && box) {
      // The first entry, not the frame around it, is level with the row.
      const first = levelItems(sub.current)[0]?.getBoundingClientRect();
      const inset = first ? first.top - box.top : 0;
      setSubPos(
        submenuPosition(
          { left: row.left, right: row.right, top: row.top - inset },
          { w: box.width, h: box.height },
          { w: window.innerWidth, h: window.innerHeight }
        )
      );
    }
    if (focusFirst.current) {
      focusFirst.current = false;
      levelItems(sub.current)[0]?.focus();
    }
  }, [open]);

  useEffect(() => {
    const returnTo = opener.current;
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openNow.current !== null) closeSubRef.current(true);
      else onClose.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const here = document.activeElement as HTMLElement | null;
    const level = here?.closest("[role=menu]") ?? ref.current;
    if (e.key === "ArrowLeft" && level === sub.current && open !== null) {
      e.preventDefault();
      closeSub(true);
      return;
    }
    if (
      e.key === "ArrowRight" &&
      here?.dataset.fold !== undefined &&
      !here.hasAttribute("disabled")
    ) {
      e.preventDefault();
      openSub(Number(here.dataset.fold), true);
      return;
    }
    const items = levelItems(level);
    if (items.length === 0) return;
    const i = items.indexOf(here as HTMLElement);
    const target = {
      ArrowDown: items[(i + 1) % items.length],
      ArrowUp: items[(i - 1 + items.length) % items.length],
      Home: items[0],
      End: items[items.length - 1],
    }[e.key];
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  const entry = (a: Action, topLevel: boolean) => (
    <li key={a.id} role="none">
      <button
        role={a.checked ? "menuitemradio" : "menuitem"}
        aria-checked={a.checked ? a.checked() : undefined}
        data-action-id={a.id}
        disabled={!isEnabled(a, ctx)}
        // A plain row of the menu itself closes a submenu left open by the pointer.
        onPointerEnter={topLevel ? () => closeSub(false) : undefined}
        onClick={() => {
          runAction(a, currentContext(targetId));
          onClose.current();
        }}
      >
        <span>{a.menuLabel?.() ?? a.label}</span>
        {bindLabel(bindsOf(a, overrides)) && <kbd>{bindLabel(bindsOf(a, overrides))}</kbd>}
        {a.checked?.() && <Check size={14} strokeWidth={2} aria-hidden />}
      </button>
    </li>
  );

  return (
    <ul
      ref={ref}
      role="menu"
      className="kern-menu"
      style={{ left: pos.x, top: pos.y }}
      data-testid="action-menu"
      onKeyDown={onKeyDown}
    >
      {sections.map((section, n) =>
        section.fold ? (
          <li
            key={section.title ?? n}
            role="none"
            className={section.rule ? "kern-menu-rule" : undefined}
          >
            <button
              ref={(b) => {
                if (b) rows.current.set(n, b);
                else rows.current.delete(n);
              }}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === n}
              data-fold={n}
              className="kern-menu-fold"
              disabled={!section.actions.some((a) => isEnabled(a, ctx))}
              onPointerEnter={() => openSub(n, false)}
              // A click from the keyboard (detail 0) also moves into the submenu.
              onClick={(e) => openSub(n, e.detail === 0)}
            >
              <span>{section.title}</span>
              <ChevronRight size={14} strokeWidth={2} aria-hidden />
            </button>
            {open === n && (
              <ul
                ref={sub}
                role="menu"
                aria-label={section.title}
                className="kern-menu kern-submenu"
                style={{ left: subPos.x, top: subPos.y }}
              >
                {section.actions.map((a) => entry(a, false))}
              </ul>
            )}
          </li>
        ) : (
          <li
            key={section.title ?? n}
            role="none"
            className={section.rule ? "kern-menu-rule" : undefined}
          >
            <ul role="group" aria-label={section.title} className="kern-menu-group">
              {section.title && (
                <li role="presentation" className="kern-label kern-menu-title">
                  {section.title}
                </li>
              )}
              {section.actions.map((a) => entry(a, true))}
            </ul>
          </li>
        )
      )}
    </ul>
  );
}
