// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useRef, useState } from "react";
import { pdfCancelJob, pdfRender, pdfRenderSize, toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { nextJobId } from "./jobs";
import { markPainted } from "./page-paint";
import { paintPixels } from "./pixels";
import type { PdfDoc } from "./usePdfDoc";
import type { PageSize } from "./page-geometry";
import { planRender } from "./render-plan";

// The pixels of one page, drawn while it is near the view and dropped when it is not. A page is
// one canvas per tile (render-plan.ts), each a picture of the engine, so none passes what the
// engine or the webview draws. The page box holds its size whether or not it is drawn, so the
// scroll does not move as pages come and go.
export function PageCanvas(props: {
  doc: PdfDoc;
  /** Counted from 0. */
  page: number;
  size: PageSize;
  /** The page's width on screen, in CSS pixels. */
  cssWidth: number;
  /** Near enough to the view to be drawn. */
  visible: boolean;
  /**
   * `size` is the page as the last edit left it. False while the sizes are being read again: the
   * picture on show stays until then, so a turned page is not drawn into the box it had before.
   */
  current: boolean;
}) {
  const { doc, page, size, cssWidth, visible, current } = props;
  const handle = doc.handle;
  const dpr = window.devicePixelRatio || 1;
  const plan = useMemo(
    () => planRender(size, cssWidth, dpr),
    [size.widthPt, size.heightPt, cssWidth, dpr] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [failure, setFailure] = useState<WireError | null>(null);
  const drawing = visible && handle !== undefined;
  // The revision at which this page last changed: a page no edit touched is not drawn again.
  const pageRevision = doc.pageRevisions[page] ?? 0;
  const render = drawing && current;

  useEffect(() => {
    setFailure(null);
    if (!render || handle === undefined) return;
    let live = true;
    const running = new Set<number>();
    // The page is on screen at this revision once every tile of it is (or has failed, which is
    // shown in its place), so a tool that put something on show itself can take it away.
    let tilesLeft = plan.tiles.length;
    const tileDone = () => {
      tilesLeft -= 1;
      if (live && tilesLeft === 0) markPainted(handle, page, pageRevision);
    };

    const drawTile = async (index: number) => {
      const tile = plan.tiles[index];
      if (!tile) return;
      const job = nextJobId();
      running.add(job);
      try {
        const picture = await pdfRenderSize(handle, page, tile.region, tile.widthPx);
        if (!live) return;
        const bytes = await pdfRender(handle, page, tile.region, tile.widthPx, job);
        if (!live) return;
        const canvas = canvases.current[index];
        if (canvas) paintPixels(canvas, picture.width, picture.height, bytes);
      } catch (e) {
        // A page that left the view or a tab that closed has no use for its picture, and the
        // render it cancelled answers Cancelled; anything else on a live page is shown.
        if (live) setFailure(toWireError(e));
      } finally {
        running.delete(job);
        tileDone();
      }
    };
    plan.tiles.forEach((_, index) => void drawTile(index));

    return () => {
      live = false;
      // Closing the document stops its jobs too, so a cancel the closed document cannot take
      // is of no consequence.
      for (const job of running) void pdfCancelJob(job).catch(() => undefined);
    };
    // A new revision of the page is an edit to it: the page is drawn again.
  }, [render, handle, pageRevision, page, plan]);

  return (
    <div className="kern-pdf-page-pixels" data-testid={`pdf-page-${page}`}>
      {drawing &&
        plan.tiles.map((tile, index) => (
          <canvas
            key={index}
            ref={(el) => {
              canvases.current[index] = el;
            }}
            className="kern-pdf-tile"
            style={{
              left: `${tile.region[0] * 100}%`,
              top: `${tile.region[1] * 100}%`,
              width: `${(tile.region[2] - tile.region[0]) * 100}%`,
              height: `${(tile.region[3] - tile.region[1]) * 100}%`,
            }}
          />
        ))}
      {failure && (
        <p className="kern-pdf-page-error" role="alert">
          Page {page + 1} could not be drawn: {errorText(failure)}
        </p>
      )}
    </div>
  );
}
