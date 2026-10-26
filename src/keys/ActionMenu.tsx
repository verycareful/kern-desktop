// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentContext, isEnabled, runAction, type Action } from "./actions";
import { clampToViewport } from "./menu-position";
import "./action-menu.css";

export type MenuSection = { title?: string; actions: Action[] };

/**
 * A menu over the action table: label, shortcut, greyed when the action
 * cannot run now. Up, Down, Home and End move between entries; Escape or an
 * outside press closes it and focus goes back to where it was. Actions run
 * aimed at `targetId` (see ActionContext.target).
 */
export function ActionMenu(props: {
  sections: MenuSection[];
  x: number;
  y: number;
  targetId?: string;
  onClose(): void;
}) {
  const { sections, targetId } = props;
  // The caller may pass a new callback on every render; the listeners below must not re-run for that.
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const ref = useRef<HTMLUListElement>(null);
  const opener = useRef(document.activeElement);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  const ctx = currentContext(targetId);

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

  useEffect(() => {
    const returnTo = opener.current;
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose.current();
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
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
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

  return (
    <ul
      ref={ref}
      role="menu"
      className="kern-menu"
      style={{ left: pos.x, top: pos.y }}
      data-testid="action-menu"
      onKeyDown={onKeyDown}
    >
      {sections.map((section, n) => (
        <li key={section.title ?? n} role="none">
          <ul role="group" aria-label={section.title} className="kern-menu-group">
            {section.title && (
              <li role="presentation" className="kern-label kern-menu-title">
                {section.title}
              </li>
            )}
            {section.actions.map((a) => (
              <li key={a.id} role="none">
                <button
                  role="menuitem"
                  data-action-id={a.id}
                  disabled={!isEnabled(a, ctx)}
                  onClick={() => {
                    runAction(a, currentContext(targetId));
                    onClose.current();
                  }}
                >
                  <span>{a.label}</span>
                  {a.keys[0] && <kbd>{a.keys[0]}</kbd>}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
