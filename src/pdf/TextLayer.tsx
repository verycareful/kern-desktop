// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useRef, useState } from "react";
import { toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { loadPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { charNear, hitTest, inLine, sameChar, selectionRects, type CharRef } from "./selection";
import { copySelection, searchSelection } from "./selection-actions";
import { percent } from "./percent";
import { SelectionMenu } from "./SelectionMenu";
import type { PageText } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

// How far the pointer must travel, in CSS pixels, for a press to be a drag and not a click.
const DRAG_PX = 3;

// Where the menu may stand, as fractions of the page, so it stays on the page.
const MENU_MAX_LEFT = 0.78;
const MENU_MAX_TOP = 0.94;

const box = (r: readonly [number, number, number, number]) => ({
  left: percent(r[0]),
  top: percent(r[1]),
  width: percent(r[2] - r[0]),
  height: percent(r[3] - r[1]),
});

// The text of one page over its picture: a transparent box per line and the selection drawn
// over them. Selecting is Kern's own (pointer events and selection.ts), not the browser's, so a
// line that runs right to left or up a turned page selects by where its glyphs are drawn.
export function TextLayer(props: {
  tabId: string;
  doc: PdfDoc;
  /** Counted from 0. */
  page: number;
  /** Near enough to the view for its text to be read. */
  visible: boolean;
  /** The page's sizes are those of its last edit (see PageCanvas). */
  current: boolean;
}) {
  const { tabId, doc, page, visible, current } = props;
  const handle = doc.handle;
  const pageRevision = doc.pageRevisions[page] ?? 0;
  const [text, setText] = useState<PageText | null>(null);
  const [failure, setFailure] = useState<WireError | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const selection = usePdfSelection((s) => s.byTab[tabId]);
  const select = usePdfSelection((s) => s.select);
  const clear = usePdfSelection((s) => s.clear);
  const mine = selection?.page === page ? selection : undefined;

  const reading = visible && current && handle !== undefined;
  useEffect(() => {
    setFailure(null);
    if (!reading) return;
    let live = true;
    loadPageText(doc, page).then(
      (read) => {
        if (live) setText(read);
      },
      (e: unknown) => {
        if (live) setFailure(toWireError(e));
      }
    );
    return () => {
      live = false;
    };
    // The page is read again when an edit changes it; `doc` is the same document throughout.
  }, [reading, handle, page, pageRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // An edit to the page moves its text, so what was selected there no longer says what it did.
  const seenRevision = useRef(pageRevision);
  useEffect(() => {
    if (seenRevision.current === pageRevision) return;
    seenRevision.current = pageRevision;
    setText(null);
    if (usePdfSelection.getState().byTab[tabId]?.page === page) clear(tabId);
  }, [pageRevision, tabId, page, clear]);

  // Only the text the selection was made on can draw it.
  const rects = useMemo(
    () => (text && mine ? selectionRects(text, mine.from, mine.to) : []),
    [text, mine]
  );

  const hasSelection = mine !== undefined;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) clear(tabId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection, tabId, clear]);

  const place = (e: React.PointerEvent): [number, number] | null => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !text) return;
    const at = place(e);
    const start: CharRef | null = at
      ? (hitTest(text, at[0], at[1]) ??
        (inLine(text, at[0], at[1]) ? charNear(text, at[0], at[1]) : null))
      : null;
    if (!start) {
      clear(tabId);
      return;
    }
    layer.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    setDragging(true);
    select(tabId, { page, from: start, to: start });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const now = usePdfSelection.getState().byTab[tabId];
    if (!d || !text || now?.page !== page) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_PX) d.moved = true;
    const at = place(e);
    const near = at ? charNear(text, at[0], at[1]) : null;
    if (near && !sameChar(near, now.to)) select(tabId, { ...now, to: near });
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    layer.current?.releasePointerCapture(e.pointerId);
    // A press that did not travel is a click: it ends the selection and starts none.
    if (!d.moved) clear(tabId);
  };

  const last = rects[rects.length - 1];
  return (
    <div
      ref={layer}
      className="kern-pdf-text"
      data-testid={`pdf-text-${page}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {text?.lines.map((line, i) => (
        <span key={i} className="kern-pdf-text-line" style={box(line.rect)}>
          {line.text}
        </span>
      ))}
      {rects.map((r, i) => (
        <span key={i} className="kern-pdf-selection" style={box(r)} data-testid="pdf-selection" />
      ))}
      {last && !dragging && (
        <SelectionMenu
          at={{ left: Math.min(last[2], MENU_MAX_LEFT), top: Math.min(last[3], MENU_MAX_TOP) }}
          onCopy={() => void copySelection(tabId, doc)}
          onSearch={() => void searchSelection(tabId, doc)}
        />
      )}
      {failure && (
        <p className="kern-pdf-text-error" role="alert">
          The text of page {page + 1} could not be read: {errorText(failure)}
        </p>
      )}
    </div>
  );
}
