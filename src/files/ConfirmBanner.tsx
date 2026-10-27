// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";

/**
 * A question above a folder view or the Trash view, answered with a button.
 * Cancel has the focus. While it is open it owns the keyboard of the view it
 * sits in (`scope`): Escape answers no, Tab, Enter and Space reach its
 * buttons, and every other key aimed inside the view is held back from the
 * shortcuts behind it (capture phase, before useShortcuts sees the event).
 * A key aimed at the page body (focus lost) is held too while `active` says this
 * view is the tab on show. A key aimed elsewhere in the window is none of its business.
 */
export function ConfirmBanner(props: {
  label: string;
  message: React.ReactNode;
  confirmLabel: string;
  scope: React.RefObject<HTMLElement | null>;
  /** True while the view the question sits in is the active tab. */
  active: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { scope, onCancel, active } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const onBody = active && (target === document.body || target === document.documentElement);
      if (!onBody && !scope.current?.contains(target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
      if (plain && ["Tab", "Enter", " "].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [scope, onCancel, active]);

  return (
    <div role="alertdialog" aria-label={props.label} className="kern-banner">
      <span>{props.message}</span>
      <span>
        <button type="button" className="kern-button" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>{" "}
        <button type="button" className="kern-button" autoFocus onClick={props.onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
