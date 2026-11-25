// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { pdfCancelJob, pdfRender, pdfRenderSize, toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { nextJobId } from "./jobs";
import type { PageSize } from "./page-geometry";
import { pdfController } from "./pdf-controller";
import { usePdfView } from "./pdf-view";
import { paintPixels } from "./pixels";
import { THUMB_WIDTH, thumbCache, thumbKey } from "./thumb-cache";
import type { PdfDoc } from "./usePdfDoc";

/** A thumbnail is drawn while it is within this many pixels of the strip's view. */
const NEAR_PX = 240;
const WHOLE_PAGE: [number, number, number, number] = [0, 0, 1, 1];

// The pages of an open PDF as small pictures, one under the other (or side by side along the
// bottom). A thumbnail is drawn while it is near the strip's view, from the cache when it has
// been drawn before, and dropped when it is not; one that scrolls away mid-draw is cancelled.
// The page in view is marked and kept in view, and a click brings a page into view in the
// pages through the controller the pages registered.
export function ThumbnailStrip(props: {
  tabId: string;
  doc: PdfDoc;
  sizes: PageSize[] | null;
  /** The revision of the document `sizes` were read at (`usePageSizes`). */
  sizesAt: number;
  /** The strip runs along the bottom: its thumbnails stand side by side. */
  horizontal: boolean;
}) {
  const { tabId, doc, sizes, sizesAt, horizontal } = props;
  const viewed = usePdfView((s) => s.byTab[tabId]?.page ?? 0);
  const current = Math.min(viewed, Math.max(0, (sizes?.length ?? 1) - 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());

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
    const root = scroller.current;
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
      { root, rootMargin: `${NEAR_PX}px` }
    );
    observer.current = io;
    for (const el of elements.current.keys()) io.observe(el);
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, []);

  // The page in view stays in view in the strip.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [current, sizes]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const here = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
    if (!here || !scroller.current) return;
    const items = [...scroller.current.querySelectorAll<HTMLElement>("[data-page]")];
    const at = items.indexOf(here);
    const to =
      e.key === forward
        ? at + 1
        : e.key === back
          ? at - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : -1;
    if (to < 0 || to >= items.length) {
      if (e.key === forward || e.key === back || e.key === "Home" || e.key === "End") {
        e.preventDefault();
      }
      return;
    }
    e.preventDefault();
    items[to]?.focus();
  };

  return (
    <div
      ref={scroller}
      className={`kern-pdf-thumbs ${horizontal ? "kern-pdf-thumbs-row" : "kern-pdf-thumbs-column"}`}
      role="list"
      aria-label="Page thumbnails"
      data-testid="pdf-thumbs"
      onKeyDown={onKeyDown}
    >
      {sizes?.map((size, page) => (
        <ThumbItem
          key={page}
          tabId={tabId}
          doc={doc}
          page={page}
          size={size}
          current={page === current}
          visible={near.has(page)}
          sized={(doc.pageRevisions[page] ?? 0) <= sizesAt}
          observe={observe}
          unobserve={unobserve}
        />
      ))}
    </div>
  );
}

const ThumbItem = memo(function ThumbItem(props: {
  tabId: string;
  doc: PdfDoc;
  page: number;
  size: PageSize;
  current: boolean;
  visible: boolean;
  /** `size` is the page as the last edit left it; false while the sizes are read again. */
  sized: boolean;
  observe(el: Element, page: number): void;
  unobserve(el: Element): void;
}) {
  const { tabId, doc, page, size, current, visible, sized, observe, unobserve } = props;
  const { handle } = doc;
  // The revision at which this page last changed: a page no edit touched keeps its thumbnail.
  const revision = doc.pageRevisions[page] ?? 0;
  const item = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<WireError | null>(null);
  const dpr = window.devicePixelRatio || 1;
  const widthPx = Math.round(THUMB_WIDTH * dpr);
  const height = Math.max(1, Math.round((THUMB_WIDTH * size.heightPt) / size.widthPt));
  const drawing = visible && handle !== undefined;
  const render = drawing && sized;

  useEffect(() => {
    const el = item.current;
    if (!el) return;
    observe(el, page);
    return () => unobserve(el);
  }, [page, observe, unobserve]);

  useEffect(() => {
    setFailure(null);
    const target = canvas.current;
    if (!render || handle === undefined || !target) return;
    const key = thumbKey(handle, revision, page, widthPx);
    const hit = thumbCache.get(key);
    if (hit) {
      try {
        paintPixels(target, hit.width, hit.height, hit.bytes);
      } catch (e) {
        setFailure(toWireError(e));
      }
      return;
    }
    let live = true;
    let running = true;
    const job = nextJobId();
    (async () => {
      try {
        const picture = await pdfRenderSize(handle, page, WHOLE_PAGE, widthPx);
        if (!live) return;
        const bytes = await pdfRender(handle, page, WHOLE_PAGE, widthPx, job);
        if (!live) return;
        paintPixels(target, picture.width, picture.height, bytes);
        thumbCache.set(key, { width: picture.width, height: picture.height, bytes });
      } catch (e) {
        // A thumbnail that left the view has no use for its picture, and the render it
        // cancelled answers Cancelled; anything else on a live one is shown.
        if (live) setFailure(toWireError(e));
      } finally {
        running = false;
      }
    })();
    return () => {
      live = false;
      if (running) void pdfCancelJob(job).catch(() => undefined);
    };
  }, [render, handle, revision, page, widthPx]);

  return (
    <div ref={item} className="kern-pdf-thumb-item" role="listitem">
      <button
        type="button"
        className="kern-pdf-thumb-button"
        data-page={page}
        // One stop in the Tab order: the page in view; the arrows move among the others.
        tabIndex={current ? 0 : -1}
        aria-label={`Page ${page + 1}`}
        aria-current={current ? "page" : undefined}
        title={`Page ${page + 1}`}
        onClick={() => pdfController(tabId)?.goToPage(page)}
      >
        <span className="kern-pdf-thumb" style={{ width: THUMB_WIDTH, height }}>
          {drawing && <canvas ref={canvas} className="kern-pdf-thumb-pixels" />}
          {failure && (
            <span className="kern-pdf-thumb-error" role="alert" title={errorText(failure)}>
              Could not be drawn
            </span>
          )}
        </span>
        <span className="kern-pdf-thumb-number">{page + 1}</span>
      </button>
    </div>
  );
});
