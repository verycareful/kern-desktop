// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { openModal } from "./modal-stack";
import "./ops.css";

// A dialog that owns the keyboard while it is open (WAI-ARIA Authoring
// Practices, "Dialog (Modal)"): Tab stays inside, Escape asks to close, the
// shortcuts behind it do not fire, and the focus goes back to where it was
// when it closes. Keys aimed at the page body, which is where the focus lands
// if the element that held it is removed, are held back too.

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function Modal(props: {
  role: "dialog" | "alertdialog";
  label: string;
  /** Escape; absent, the dialog has no way to be dismissed by key. */
  onEscape?(): void;
  /** The element that takes the focus on opening; absent, the first one the dialog holds. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const onEscape = useRef(props.onEscape);
  useEffect(() => {
    onEscape.current = props.onEscape;
  });
  const initial = props.initialFocus;

  useEffect(() => {
    const opener = document.activeElement;
    const me = openModal();
    const first = initial?.current ?? root.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // Keys aimed outside the dialog never reach the shortcuts behind it.
    const onKey = (e: KeyboardEvent) => {
      if (!me.isTop()) return;
      const target = e.target;
      if (!(target instanceof Node) || root.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onEscape.current?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      me.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [initial]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape.current?.();
    } else if (e.key === "Tab") {
      const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      if (first && last) {
        const at = document.activeElement;
        if (e.shiftKey && at === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    // The window's shortcuts are not for what is typed in a dialog.
    e.stopPropagation();
  };

  return (
    <div className="kern-modal-backdrop">
      <div
        ref={root}
        role={props.role}
        aria-modal="true"
        aria-label={props.label}
        className={"kern-modal" + (props.className ? ` ${props.className}` : "")}
        data-testid={props.testId}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  );
}
