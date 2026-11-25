// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useRef, useState } from "react";
import { pdfCancelJob, pdfRender, pdfRenderSize, toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { nextJobId } from "./jobs";
import type { PdfDoc } from "./usePdfDoc";
import type { PageSize } from "./page-geometry";
import { planRender } from "./render-plan";

const BYTES_PER_PIXEL = 4;

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
}) {
  const { doc, page, size, cssWidth, visible } = props;
  const handle = doc.handle;
  const dpr = window.devicePixelRatio || 1;
  const plan = useMemo(
    () => planRender(size, cssWidth, dpr),
    [size.widthPt, size.heightPt, cssWidth, dpr] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [failure, setFailure] = useState<WireError | null>(null);
  const drawing = visible && handle !== undefined;

  useEffect(() => {
    setFailure(null);
    if (!drawing || handle === undefined) return;
    let live = true;
    const running = new Set<number>();

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
        if (bytes.length !== picture.width * picture.height * BYTES_PER_PIXEL) {
          throw new Error(
            `the engine drew ${bytes.length} bytes for a picture of ${picture.width} by ${picture.height} pixels`
          );
        }
        const canvas = canvases.current[index];
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
          if (canvas) throw new Error("this webview gives no 2D canvas to draw a page on");
          return;
        }
        canvas.width = picture.width;
        canvas.height = picture.height;
        const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length);
        context.putImageData(new ImageData(pixels, picture.width, picture.height), 0, 0);
      } catch (e) {
        // A page that left the view or a tab that closed has no use for its picture, and the
        // render it cancelled answers Cancelled; anything else on a live page is shown.
        if (live) setFailure(toWireError(e));
      } finally {
        running.delete(job);
      }
    };
    plan.tiles.forEach((_, index) => void drawTile(index));

    return () => {
      live = false;
      // Closing the document stops its jobs too, so a cancel the closed document cannot take
      // is of no consequence.
      for (const job of running) void pdfCancelJob(job).catch(() => undefined);
    };
    // The revision is an edit: the page is drawn again.
  }, [drawing, handle, doc.revision, page, plan]);

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
