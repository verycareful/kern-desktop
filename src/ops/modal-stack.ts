// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The dialogs that are open, the one opened last on top. Only the top one holds
// the keyboard, so a dialog opened over another (a report over a question) is
// not shut out by the one below; and anything that ends an edit when the focus
// leaves it asks here whether the focus went to a dialog, which is not the user
// leaving the edit.

const open: symbol[] = [];

/** Registers an open dialog. The returned functions say whether it is on top and take it away. */
export function openModal(): { isTop(): boolean; close(): void } {
  const me = Symbol("modal");
  open.push(me);
  return {
    isTop: () => open[open.length - 1] === me,
    close: () => {
      const at = open.indexOf(me);
      if (at >= 0) open.splice(at, 1);
    },
  };
}

/** True when a dialog is open, or `to` (where the focus is going) is inside one. */
export function focusGoesToADialog(to: EventTarget | null): boolean {
  return (
    open.length > 0 ||
    (to instanceof Element && to.closest('[role="dialog"], [role="alertdialog"]') !== null)
  );
}
