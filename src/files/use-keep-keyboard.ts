// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, type FocusEvent, type RefObject } from "react";

// The keyboard is never lost to the page body (design 4.5). While focus is on
// something inside a view, that is remembered; if that element is then removed
// (the last file deleted, the confirmation answered), the browser leaves the
// focus on the body without a blur event, and the view gives it to `target`
// (its list, or the note that stands where the list was) on the next render.
// Focus that moved elsewhere on purpose is not taken back: a blur towards
// another element, or to the page with the window still focused, forgets it;
// a blur because the whole window lost focus does not, since focus comes back
// to the same element.
export function useKeepKeyboard(
  container: RefObject<HTMLElement | null>,
  target: () => HTMLElement | null
) {
  const held = useRef(false);
  useEffect(() => {
    const at = document.activeElement;
    if (held.current && (at === null || at === document.body)) target()?.focus();
  });
  return {
    onFocus: () => {
      held.current = true;
    },
    onBlur: (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node) held.current = container.current?.contains(to) ?? false;
      else if (document.hasFocus()) held.current = false;
    },
  };
}
