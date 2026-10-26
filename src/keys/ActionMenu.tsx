// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import { currentContext, isEnabled, runAction, type Action } from "./actions";
import "./action-menu.css";

/**
 * A context menu over the action table: label, shortcut, greyed when the
 * action cannot run now. Closes on Escape, on an outside press, or after a run.
 */
export function ActionMenu(props: { actions: Action[]; x: number; y: number; onClose(): void }) {
  const { actions, x, y, onClose } = props;
  const ref = useRef<HTMLUListElement>(null);
  const ctx = currentContext();

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  return (
    <ul
      ref={ref}
      role="menu"
      className="kern-menu"
      style={{ left: x, top: y }}
      data-testid="action-menu"
    >
      {actions.map((a) => (
        <li key={a.id} role="none">
          <button
            role="menuitem"
            disabled={!isEnabled(a, ctx)}
            onClick={() => {
              runAction(a, currentContext());
              onClose();
            }}
          >
            <span>{a.label}</span>
            {a.keys[0] && <kbd>{a.keys[0]}</kbd>}
          </button>
        </li>
      ))}
    </ul>
  );
}
