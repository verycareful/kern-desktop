// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useRef, useState } from "react";
import { pdfLinks, toWireError, type PdfLink, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { annotationAt } from "./annotations";
import { markSelection, noteAtSelection } from "./annotation-actions";
import { followLink } from "./link-actions";
import { linkAt } from "./links";
import { loadPageText } from "./page-text";
import { usePdfFind } from "./pdf-find";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool } from "./pdf-tool";
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

const linkLabel = (link: PdfLink) =>
  typeof link.page === "number" ? `Go to page ${link.page + 1}` : `Link to ${link.uri ?? "a file"}`;

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
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; selecting: boolean } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const selection = usePdfSelection((s) => s.byTab[tabId]);
  const select = usePdfSelection((s) => s.select);
  const clear = usePdfSelection((s) => s.clear);
  const mine = selection?.page === page ? selection : undefined;
  const hits = usePdfFind((s) => s.byTab[tabId]?.hits[page]);
  const currentHit = usePdfFind((s) => {
    const c = s.byTab[tabId]?.current;
    return c?.page === page ? c.index : -1;
  });

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

  // The links of the page are read with its text; a page whose links cannot be read has none to
  // follow, and its text still selects.
  useEffect(() => {
    if (!reading || handle === undefined) {
      setLinks([]);
      return;
    }
    let live = true;
    pdfLinks(handle, page).then(
      (read) => {
        if (live) setLinks(read);
      },
      () => {
        if (live) setLinks([]);
      }
    );
    return () => {
      live = false;
    };
  }, [reading, handle, page, pageRevision]);

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

  // The annotation of the page under the point, if one can be picked there.
  const annotationUnder = (at: [number, number]) =>
    annotationAt(usePdfTool.getState().listed[tabId]?.[page] ?? [], at[0], at[1]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const at = place(e);
    const start: CharRef | null =
      at && text
        ? (hitTest(text, at[0], at[1]) ??
          (inLine(text, at[0], at[1]) ? charNear(text, at[0], at[1]) : null))
        : null;
    if (!start) {
      clear(tabId);
      // A press on a link or an annotation that is not on text is a click on it when it is let
      // go in place.
      if (at && (linkAt(links, at[0], at[1]) || annotationUnder(at))) {
        drag.current = { x: e.clientX, y: e.clientY, moved: false, selecting: false };
      } else if (usePdfTool.getState().byTab[tabId]?.picked) {
        usePdfTool.getState().pick(tabId, null);
      }
      return;
    }
    // Text selected over an annotation is the text, not the annotation.
    if (usePdfTool.getState().byTab[tabId]?.picked) usePdfTool.getState().pick(tabId, null);
    layer.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, selecting: true };
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
    if (d.selecting) {
      setDragging(false);
      layer.current?.releasePointerCapture(e.pointerId);
    }
    // A press that did not travel is a click: it ends the selection and starts none, and on a
    // link it follows the link. A press that travelled selected the text it crossed.
    const travelled = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_PX;
    if (travelled) return;
    clear(tabId);
    if (e.type === "pointercancel") return;
    const at = place(e);
    const link = at ? linkAt(links, at[0], at[1]) : undefined;
    if (link) {
      followLink(tabId, link, doc.pages);
      return;
    }
    const annotation = at ? annotationUnder(at) : null;
    usePdfTool.getState().pick(tabId, annotation ? { page, id: annotation.id } : null);
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
      {hits?.map((hit, i) =>
        hit.rects.map((r, j) => (
          <span
            key={`${i}-${j}`}
            className={i === currentHit ? "kern-pdf-hit kern-pdf-hit-current" : "kern-pdf-hit"}
            style={box(r)}
            data-testid={i === currentHit ? "pdf-hit-current" : "pdf-hit"}
          />
        ))
      )}
      {links.map((link, i) =>
        link.rects.map((r, j) => (
          <button
            key={`${i}-${j}`}
            type="button"
            className="kern-pdf-link"
            style={box(r)}
            tabIndex={j === 0 ? 0 : -1}
            aria-hidden={j === 0 ? undefined : true}
            aria-label={linkLabel(link)}
            data-testid="pdf-link"
            // A press of the pointer is the layer's (a drag over a link still selects); the key is the button's.
            onClick={(e) => {
              if (e.detail === 0) followLink(tabId, link, doc.pages);
            }}
          />
        ))
      )}
      {rects.map((r, i) => (
        <span key={i} className="kern-pdf-selection" style={box(r)} data-testid="pdf-selection" />
      ))}
      {last && !dragging && (
        <SelectionMenu
          at={{ left: Math.min(last[2], MENU_MAX_LEFT), top: Math.min(last[3], MENU_MAX_TOP) }}
          onCopy={() => void copySelection(tabId, doc)}
          onSearch={() => void searchSelection(tabId, doc)}
          canMark={doc.canEdit}
          onMark={(kind) => void markSelection(tabId, doc, kind)}
          onNote={() =>
            void noteAtSelection(tabId, doc, [
              Math.min(last[2], MENU_MAX_LEFT),
              Math.min(last[3], MENU_MAX_TOP),
            ])
          }
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
