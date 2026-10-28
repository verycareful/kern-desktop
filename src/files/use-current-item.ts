// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";

// Where the keyboard is in a list or grid (design 4.5): the current item is
// outlined while the view itself has the keyboard, and only then. With no
// current item the first one stands in for it; the selection is not touched.
// Focus on something inside the view (a column header button) or anywhere
// else, another window included, is not the view having the keyboard. The view
// getting the keyboard with no cursor seeds one at the first item (`onSeed`,
// selection.ts seedCursor), so arrow keys move on from the item shown.
export function useCurrentItem(count: number, cursor: number | null, onSeed: () => void) {
  const [focused, setFocused] = useState(false);
  const current = cursor ?? (focused && count > 0 ? 0 : null);
  return {
    /** The index to outline now, or null. */
    outlined: focused ? current : null,
    /** The index for aria-activedescendant. */
    current,
    /** Handlers for the focusable root of the view. */
    handlers: {
      onFocus: (e: React.FocusEvent) => {
        if (e.target !== e.currentTarget) return;
        setFocused(true);
        if (cursor === null && count > 0) onSeed();
      },
      onBlur: (e: React.FocusEvent) => e.target === e.currentTarget && setFocused(false),
    },
  };
}
