// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useViewSettings } from "../files/view-settings";
import { toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { GoToPage } from "./GoToPage";
import { PageCanvas } from "./PageCanvas";
import {
  FIT_WIDTH,
  PAGE_MARGIN,
  factorOf,
  layoutBoxes,
  pageSizes,
  rowAtOffset,
  scaleOf,
  stepZoom,
  type PageSize,
  type Zoom,
} from "./page-geometry";
import { registerPdf } from "./pdf-controller";
import { usePdfView } from "./pdf-view";
import type { PdfDoc } from "./usePdfDoc";
import { acrossOf, layoutOf, layoutRows, rowOfPage } from "./view-layout";

/** A wheel turn of this many pixels with Ctrl held is one zoom step. */
const WHEEL_PER_STEP = 100;
/** A wheel that counts lines, not pixels, is this many pixels a line. */
const WHEEL_LINE_PX = 16;
const DOM_DELTA_LINE = 1;

interface Anchor {
  /** The page in view: the first of its row, or the one the reader was last on if it is in the row. */
  page: number;
  /** How far down the page's row the top of the view is, as a fraction of its height. */
  frac: number;
  /** The view is at the very top of the scroll. */
  top: boolean;
}

// The pages of an open PDF in the layout the settings name (view-layout.ts): a continuous
// scroll, one page at a time, a spread or a grid. Sized from the engine, drawn while near the
// view, zoomed to the width of the view or by a factor. The page in view and the zoom are
// published for the status bar (pdf-view.ts) and the actions reach the zoom through the
// controller (pdf-controller.ts).
export function PdfPages(props: { tabId: string; doc: PdfDoc; active: boolean }) {
  const { tabId, doc, active } = props;
  const scroll = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [sizeError, setSizeError] = useState<WireError | null>(null);
  const [zoom, setZoom] = useState<Zoom>(FIT_WIDTH);
  const [view, setView] = useState({ width: 0, height: 0 });
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());
  const goTo = usePdfView((s) => s.byTab[tabId]?.goTo ?? false);
  const current = usePdfView((s) => s.byTab[tabId]?.page ?? 0);
  const layoutKind = useViewSettings((s) => s.pdfLayout);
  const gridAcross = useViewSettings((s) => s.pdfGridAcross);
  const layout = useMemo(() => layoutOf(layoutKind, gridAcross), [layoutKind, gridAcross]);
  const across = acrossOf(layout);
  const single = layout.kind === "single";
  const patchView = usePdfView((s) => s.patch);
  const clearView = usePdfView((s) => s.clear);

  const { handle, pages, revision } = doc;
  useEffect(() => {
    if (handle === undefined) return;
    let stale = false;
    setSizeError(null);
    pageSizes(handle, pages, () => stale).then(
      (read) => {
        if (!stale) setSizes(read);
      },
      (e) => {
        if (!stale) setSizeError(toWireError(e));
      }
    );
    return () => {
      stale = true;
    };
  }, [handle, pages, revision]);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const measure = () => setView({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  const count = sizes?.length ?? 0;
  const shown = Math.min(current, Math.max(0, count - 1));
  // One page at a time is the page the status bar names, as one row; every other layout sets
  // out all the pages.
  const rows = useMemo(
    () => (single ? (count > 0 ? [[shown]] : []) : layoutRows(layout, count)),
    [layout, single, count, shown]
  );
  const scale = sizes ? scaleOf(zoom, sizes, view.width, across) : 1;
  const boxes = useMemo(
    () => (sizes ? layoutBoxes(sizes, rows, scale) : null),
    [sizes, rows, scale]
  );
  const factor = factorOf(scale);
  const contentWidth = Math.max(view.width, (boxes?.width ?? 0) + 2 * PAGE_MARGIN);
  const blockLeft = (contentWidth - (boxes?.width ?? 0)) / 2;

  // The page the top of the view is on, and how far into it, so a zoom or a resize keeps what
  // the reader is looking at where it was.
  const anchor = useRef<Anchor>({ page: 0, frac: 0, top: true });
  const boxesNow = useRef(boxes);
  const rowsNow = useRef(rows);
  const singleNow = useRef(single);
  useLayoutEffect(() => {
    boxesNow.current = boxes;
    rowsNow.current = rows;
    singleNow.current = single;
  });
  const onScroll = useCallback(() => {
    const el = scroll.current;
    const b = boxesNow.current;
    // One page at a time is stepped to, never scrolled to: the page is the one shown.
    if (!el || !b || singleNow.current) return;
    const index = rowAtOffset(b.rows, el.scrollTop);
    const row = b.rows[index];
    if (!row) return;
    const page = row.pages.includes(anchor.current.page)
      ? anchor.current.page
      : (row.pages[0] ?? 0);
    const frac =
      row.height > 0 ? Math.min(1, Math.max(0, (el.scrollTop - row.top) / row.height)) : 0;
    anchor.current = { page, frac, top: el.scrollTop <= 0 };
    patchView(tabId, { page });
  }, [patchView, tabId]);
  // A zoom, a resize or a new layout puts the view back on the row of the page it was on; a new
  // layout starts at the top of that row.
  const layoutKey = `${layout.kind}:${across}`;
  const layoutNow = useRef(layoutKey);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !boxes) return;
    if (layoutNow.current !== layoutKey) {
      layoutNow.current = layoutKey;
      const a = anchor.current;
      anchor.current = { page: a.page, frac: 0, top: a.top && a.page === 0 };
    }
    const a = anchor.current;
    const row = boxes.rows[rowOfPage(rowsNow.current, a.page)];
    if (!row) return;
    el.scrollTop = a.top ? 0 : Math.max(0, row.top + a.frac * row.height);
  }, [boxes, layoutKey]);

  const showPage = useCallback(
    (page: number) => {
      anchor.current = { page, frac: 0, top: true };
      patchView(tabId, { page });
    },
    [patchView, tabId]
  );
  const goToPage = useCallback(
    (page: number) => {
      const el = scroll.current;
      const b = boxesNow.current;
      if (!el || !b) return;
      if (singleNow.current) {
        showPage(page);
        return;
      }
      const index = rowOfPage(rowsNow.current, page);
      const row = b.rows[index];
      if (!row) return;
      el.scrollTop = index === 0 ? 0 : row.top;
      anchor.current = { page, frac: 0, top: index === 0 };
      patchView(tabId, { page });
    },
    [patchView, showPage, tabId]
  );
  const stepPage = useCallback(
    (direction: 1 | -1) => {
      const next = shown + direction;
      if (next >= 0 && next < count) showPage(next);
    },
    [shown, count, showPage]
  );
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!single || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const direction =
      e.key === "PageDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "PageUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (direction === 0) return;
    e.preventDefault();
    stepPage(direction);
  };

  // Which pages are within a screen of the view: only those are drawn.
  const elements = useRef(new Map<Element, number>());
  const observer = useRef<IntersectionObserver | null>(null);
  const observe = useCallback((el: Element, page: number) => {
    elements.current.set(el, page);
    observer.current?.observe(el);
  }, []);
  const unobserve = useCallback((el: Element) => {
    elements.current.delete(el);
    observer.current?.unobserve(el);
  }, []);
  useEffect(() => {
    const root = scroll.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((before) => {
          const next = new Set(before);
          for (const entry of entries) {
            const page = elements.current.get(entry.target);
            if (page === undefined) continue;
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next.size === before.size && [...next].every((p) => before.has(p)) ? before : next;
        }),
      { root, rootMargin: `${view.height}px 0px` }
    );
    observer.current = io;
    for (const el of elements.current.keys()) io.observe(el);
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, [view.height]);

  // The zoom is stepped from what the pages are at now, so a fit that is between two steps goes
  // to the next one.
  const factorNow = useRef(factor);
  useLayoutEffect(() => {
    factorNow.current = factor;
  });
  const zoomBy = useCallback((direction: 1 | -1) => {
    setZoom({ fit: false, factor: stepZoom(factorNow.current, direction) });
  }, []);
  useEffect(
    () =>
      registerPdf(tabId, {
        zoomIn: () => zoomBy(1),
        zoomOut: () => zoomBy(-1),
        zoomFit: () => setZoom(FIT_WIDTH),
        askGoToPage: () => patchView(tabId, { goTo: true }),
      }),
    [tabId, zoomBy, patchView]
  );

  // Ctrl and the wheel zoom. React's own wheel handler is passive and could not keep the
  // webview from zooming the whole page, so the listener is added here.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let turned = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      turned += e.deltaMode === DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      while (Math.abs(turned) >= WHEEL_PER_STEP) {
        zoomBy(turned < 0 ? 1 : -1);
        turned -= Math.sign(turned) * WHEEL_PER_STEP;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  useEffect(() => {
    patchView(tabId, { pages, zoom: sizes ? factor : 0 });
  }, [patchView, tabId, pages, sizes, factor]);
  useEffect(() => () => clearView(tabId), [clearView, tabId]);

  return (
    <>
      <div
        ref={scroll}
        className="kern-pdf-scroll"
        tabIndex={0}
        role="document"
        aria-label="Pages"
        data-testid="pdf-scroll"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {sizeError && (
          <div className="kern-doc-note" role="alert" data-testid="pdf-sizes-failed">
            <p>The pages could not be measured.</p>
            <p>{errorText(sizeError)}</p>
          </div>
        )}
        {!sizeError && !boxes && (
          <div className="kern-doc-note" role="status" data-testid="pdf-measuring">
            <p>Reading the pages…</p>
          </div>
        )}
        {boxes && sizes && (
          <div
            className="kern-pdf-pages"
            style={{ width: contentWidth, height: boxes.total }}
            data-testid="pdf-pages"
            data-zoom={factor}
          >
            {sizes.map((size, page) => {
              const box = boxes.pages[page];
              if (!box) return null;
              return (
                <PageSlot
                  key={page}
                  page={page}
                  left={blockLeft + box.left}
                  top={box.top}
                  width={box.width}
                  height={box.height}
                  observe={observe}
                  unobserve={unobserve}
                >
                  <PageCanvas
                    doc={doc}
                    page={page}
                    size={size}
                    cssWidth={box.width}
                    visible={near.has(page)}
                  />
                </PageSlot>
              );
            })}
          </div>
        )}
      </div>
      {active && goTo && boxes && (
        <GoToPage
          pages={pages}
          current={current}
          onGo={(page) => {
            patchView(tabId, { goTo: false });
            goToPage(page);
          }}
          onCancel={() => patchView(tabId, { goTo: false })}
        />
      )}
    </>
  );
}

const PageSlot = memo(function PageSlot(props: {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
  observe(el: Element, page: number): void;
  unobserve(el: Element): void;
  children: React.ReactNode;
}) {
  const { page, observe, unobserve } = props;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    observe(el, page);
    return () => unobserve(el);
  }, [page, observe, unobserve]);
  return (
    <div
      ref={box}
      className="kern-pdf-page"
      role="group"
      aria-label={`Page ${page + 1}`}
      data-page={page}
      style={{ left: props.left, top: props.top, width: props.width, height: props.height }}
    >
      {props.children}
    </div>
  );
});
