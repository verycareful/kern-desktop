// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import type { Rgb } from "../ipc/pdf";
import { INK_GROUP_MS, cssColour, extendStroke, fractionAt } from "./annotations";

type Stroke = [number, number][];

interface Look {
  colour: Rgb;
  widthPt: number;
}

const pointsOf = (stroke: Stroke): string =>
  // A stroke of one point is drawn as a line of no length, which a round cap makes a dot.
  (stroke.length === 1 ? [stroke[0]!, stroke[0]!] : stroke).map((p) => `${p[0]},${p[1]}`).join(" ");

// The surface a line is drawn on, over a page: lines drawn within INK_GROUP_MS of each other are
// one change, so a word written with a few lines is one step to undo. A line stays on the
// surface until the engine has answered, so it does not vanish and return. A refused change
// leaves the page as it was (the document says why).
export function InkTool(props: {
  colour: Rgb;
  /** The line's width, in points. */
  widthPt: number;
  /** CSS pixels to a point on this page, for the width of the line drawn. */
  pxPerPt: number;
  /** Makes the change; resolves when the engine has answered. */
  onGroup(strokes: Stroke[], colour: Rgb, widthPt: number): Promise<void>;
}) {
  const { colour, widthPt, pxPerPt } = props;
  const surface = useRef<HTMLDivElement>(null);
  const onGroup = useRef(props.onGroup);
  onGroup.current = props.onGroup;
  // The unmount below runs the first render's closures, so what it needs is read from here.
  const latest = useRef<Look>({ colour, widthPt });
  latest.current = { colour, widthPt };
  // What is on show: the lines let go (held, or sent and not yet answered) and the one being drawn.
  const [shown, setShown] = useState<{ stroke: Stroke; look: Look }[]>([]);
  const [drawing, setDrawing] = useState<Stroke | null>(null);
  const held = useRef<Stroke[]>([]);
  const heldLook = useRef<Look | null>(null);
  const current = useRef<Stroke | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  const send = () => {
    clearTimeout(timer.current);
    const group = held.current;
    const look = heldLook.current;
    if (group.length === 0 || !look) return;
    held.current = [];
    heldLook.current = null;
    void onGroup.current(group, look.colour, look.widthPt).finally(() => {
      if (mounted.current) setShown((s) => s.slice(group.length));
    });
  };

  const letGo = () => {
    const stroke = current.current;
    if (!stroke) return;
    current.current = null;
    const look = heldLook.current ?? latest.current;
    heldLook.current = look;
    held.current.push(stroke);
    setShown((s) => [...s, { stroke, look }]);
    setDrawing(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(send, INK_GROUP_MS);
  };

  // Leaving the tool, or the page, makes what was drawn a change and does not drop it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      letGo();
      send();
    };
    // `letGo` and `send` read refs only, so the cleanup of the first render is the last one's.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (e: React.PointerEvent): [number, number] | null => {
    const r = surface.current?.getBoundingClientRect();
    return r ? fractionAt(e.clientX, e.clientY, r) : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const at = place(e);
    if (!at) return;
    // A line in another colour or width is another change.
    const look = heldLook.current;
    if (look && (look.widthPt !== widthPt || look.colour.some((c, i) => c !== colour[i]))) send();
    surface.current?.setPointerCapture(e.pointerId);
    current.current = [at];
    setDrawing([at]);
    clearTimeout(timer.current);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const stroke = current.current;
    if (!stroke) return;
    const at = place(e);
    if (!at) return;
    const next = extendStroke(stroke, at);
    if (next === stroke) return;
    current.current = next;
    setDrawing(next);
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!current.current) return;
    surface.current?.releasePointerCapture(e.pointerId);
    letGo();
  };

  const line = (stroke: Stroke, look: Look, key: string | number) => (
    <polyline
      key={key}
      points={pointsOf(stroke)}
      fill="none"
      stroke={cssColour(look.colour)}
      strokeWidth={look.widthPt * pxPerPt}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );

  return (
    <div
      ref={surface}
      className="kern-pdf-ink-surface"
      data-testid="pdf-ink-surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {shown.map((s, i) => line(s.stroke, s.look, i))}
        {drawing && line(drawing, { colour, widthPt }, "drawing")}
      </svg>
    </div>
  );
}
