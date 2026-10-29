// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import "@testing-library/jest-dom/vitest";

// jsdom has no PointerEvent. A MouseEvent carries the coordinates, buttons and modifier keys
// that the pointer code under test reads, and testing-library builds pointer events from this.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: PointerEventPolyfill,
  });
}
