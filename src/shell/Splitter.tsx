// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { KeyboardEvent, PointerEvent } from "react";

// A divider that sets the width of the pane on one side of it: dragged, or
// moved with the arrow keys (Shift for a bigger step), Home and End for the
// narrowest and widest. `grows` says which way the divider moves to widen
// the pane: "right" for a pane on its left (the editor's folder column),
// "left" for a pane on its right (Pinned and Recent).

/** How far an arrow key moves the divider, in pixels, and Shift with it: a step a hand can follow. */
const SPLIT_STEP = 16;
const SPLIT_STEP_BIG = 64;

export function Splitter(props: {
  width: number;
  min: number;
  max: number;
  /** Takes the wanted width; the owner clamps it. */
  setWidth(width: number): void;
  grows: "left" | "right";
  label: string;
  className: string;
  testId: string;
}) {
  const { width, min, max, setWidth, grows } = props;
  const sign = grows === "right" ? 1 : -1;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = width;
    const move = (ev: globalThis.PointerEvent) => setWidth(start + sign * (ev.clientX - startX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = (e.shiftKey ? SPLIT_STEP_BIG : SPLIT_STEP) * sign;
    const to = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: min,
      End: max,
    }[e.key];
    if (to === undefined || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    setWidth(to);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={props.className}
      data-testid={props.testId}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
