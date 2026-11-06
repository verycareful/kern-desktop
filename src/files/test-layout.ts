// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// jsdom has no layout, so a virtualised list would show no rows. This gives
// every element a fixed size (the viewport the tests assume) until restored.
export function stubLayout(width = 800, height = 600): () => void {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
  const original = Element.prototype.getBoundingClientRect;
  // The virtual list reads clientWidth and clientHeight of its scroller.
  const props = ["clientWidth", "clientHeight"] as const;
  const saved = props.map((n) => Object.getOwnPropertyDescriptor(Element.prototype, n));
  Element.prototype.getBoundingClientRect = () => rect;
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, value: height });
  return () => {
    Element.prototype.getBoundingClientRect = original;
    props.forEach((n, i) => {
      const d = saved[i];
      if (d) Object.defineProperty(Element.prototype, n, d);
    });
  };
}
