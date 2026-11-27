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

// CodeMirror measures text with Range and Element geometry that jsdom does not implement. These
// stand-ins give every box zero size, which is enough for the editor to build and take input.
const emptyRects = (): DOMRectList => {
  const list = [] as unknown as DOMRectList;
  (list as unknown as { item: (i: number) => DOMRect | null }).item = () => null;
  return list;
};
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
}
if (typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}

// jsdom does no layout, so it has no scrollIntoView; Settings scrolls a section into view when
// asked for it. Scrolling there has nothing to move, so a stand-in that does nothing is exact.
Element.prototype.scrollIntoView ??= () => undefined;

// jsdom does no layout, so it has no observers of size or of what is in view. These stand-ins
// report nothing; a test that depends on one installs its own (src/pdf/PdfPages.test.tsx).
class QuietObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
globalThis.ResizeObserver ??= QuietObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= QuietObserver as unknown as typeof IntersectionObserver;
