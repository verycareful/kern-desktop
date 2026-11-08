// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { X } from "lucide-react";
import { RepeatFlash } from "./repeat-flash";

/**
 * A banner that says what failed, with its dismiss button in the top right corner: the button is a
 * square (shell.css .kern-dismiss) with the same space above it as to its right.
 */
export function ErrorBanner(props: {
  onDismiss(): void;
  /** What the message is kept in: set again to the same words, the banner flashes. */
  watch?: unknown;
  children: React.ReactNode;
}) {
  return (
    <div role="alert" className="kern-banner kern-banner-dismissible">
      {props.children}
      <RepeatFlash watch={props.watch} />
      <button
        type="button"
        className="kern-icon-button kern-dismiss"
        aria-label="Dismiss"
        onClick={props.onDismiss}
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
