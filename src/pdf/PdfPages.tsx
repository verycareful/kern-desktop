// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { GoToPage } from "./GoToPage";
import { PageCanvas } from "./PageCanvas";
import {
  FIT_WIDTH,
  PAGE_MARGIN,
  factorOf,
  pageAtOffset,
  pageBoxes,
  pageSizes,
  scaleOf,
  stepZoom,
  type PageSize,
  type Zoom,
} from "./page-geometry";
import { registerPdf } from "./pdf-controller";
import { usePdfView } from "./pdf-view";
import type { PdfDoc } from "./usePdfDoc";

/** A wheel turn of this many pixels with Ctrl held is one zoom step. */
const WHEEL_PER_STEP = 100;
/** A wheel that counts lines, not pixels, is this many pixels a line. */
const WHEEL_LINE_PX = 16;
const DOM_DELTA_LINE = 1;

interface Anchor {
  page: number;
  /** How far down the page the top of the view is, as a fraction of its height. */
  frac: number;
  /** The view is at the very top of the scroll. */
  top: boolean;
}

// The pages of an open PDF in one continuous scroll: sized from the engine, drawn while near
// the view, zoomed to the width of the view or by a factor. The page in view and the zoom are
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

  const scale = sizes ? scaleOf(zoom, sizes, view.width) : 1;
  const boxes = useMemo(() => (sizes ? pageBoxes(sizes, scale) : null), [sizes, scale]);
  const factor = factorOf(scale);
  const widest = boxes ? Math.max(0, ...boxes.pages.map((box) => box.width)) : 0;
  const contentWidth = Math.max(view.width, widest + 2 * PAGE_MARGIN);

  // The page the top of the view is on, and how far into it, so a zoom or a resize keeps what
  // the reader is looking at where it was.
  const anchor = useRef<Anchor>({ page: 0, frac: 0, top: true });
  const boxesNow = useRef(boxes);
  useLayoutEffect(() => {
    boxesNow.current = boxes;
  });
  const onScroll = useCallback(() => {
    const el = scroll.current;
    const b = boxesNow.current;
    if (!el || !b) return;
    const page = pageAtOffset(b.pages, el.scrollTop);
    const box = b.pages[page];
    if (!box) return;
    const frac = Math.min(1, Math.max(0, (el.scrollTop - box.top) / box.height));
    anchor.current = { page, frac, top: el.scrollTop <= 0 };
    patchView(tabId, { page });
  }, [patchView, tabId]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !boxes) return;
    const a = anchor.current;
    const box = boxes.pages[a.page];
    if (!box) return;
    el.scrollTop = a.top ? 0 : Math.max(0, box.top + a.frac * box.height);
  }, [boxes]);

  const goToPage = useCallback(
    (page: number) => {
      const el = scroll.current;
      const b = boxesNow.current;
      const box = b?.pages[page];
      if (!el || !box) return;
      el.scrollTop = page === 0 ? 0 : box.top;
      onScroll();
    },
    [onScroll]
  );

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
                  left={(contentWidth - box.width) / 2}
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
