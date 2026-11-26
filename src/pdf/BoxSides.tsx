// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef } from "react";
import { fractionAt } from "./annotations";
import { KEY_STEP, KEY_STEP_SHIFT, moveLeft, moveRight, type Sides } from "./box-sides";

type Side = "left" | "right";

// The two sides of a text box as handles: a drag moves the side under the pointer, and the arrow
// keys move a side that has the focus. The box this is in is placed in fractions of the page that
// `.kern-pdf-blocks` covers, so the pointer is read against that.
export function BoxSides(props: {
  sides: Sides;
  /** The least width of the box, as a fraction of the page's width. */
  min: number;
  /** Where a dragged right side comes to rest: the page's own widths may take it. */
  snapRight?(right: number, left: number): number;
  disabled?: boolean;
  onChange(sides: Sides): void;
}) {
  const { sides, min, snapRight, disabled, onChange } = props;
  const dragging = useRef<Side | null>(null);

  const place = (side: Side, at: number, snap: boolean) => {
    if (side === "left") onChange(moveLeft(sides, at, min));
    else onChange(moveRight(sides, snap && snapRight ? snapRight(at, sides.left) : at, min));
  };

  const pointerAt = (e: React.PointerEvent<HTMLElement>): number | null => {
    const page = e.currentTarget.closest<HTMLElement>(".kern-pdf-blocks");
    const bounds = page?.getBoundingClientRect();
    const at = bounds ? fractionAt(e.clientX, e.clientY, bounds) : null;
    return at ? at[0] : null;
  };

  const handle = (side: Side) => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Left side of the box" : "Right side of the box"}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(sides[side] * 1000) / 1000}
      tabIndex={disabled ? -1 : 0}
      className={`kern-pdf-box-side kern-pdf-box-side-${side}`}
      data-testid={`pdf-box-side-${side}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || disabled) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = side;
      }}
      onPointerMove={(e) => {
        if (dragging.current !== side) return;
        const at = pointerAt(e);
        if (at !== null) place(side, at, true);
      }}
      onPointerUp={(e) => {
        if (dragging.current !== side) return;
        dragging.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
        place(side, sides[side] + (e.key === "ArrowLeft" ? -step : step), false);
      }}
    />
  );

  return (
    <>
      {handle("left")}
      {handle("right")}
    </>
  );
}
