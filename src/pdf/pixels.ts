// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

const BYTES_PER_PIXEL = 4;

/**
 * Puts a picture from the engine on `canvas`: straight RGBA8 rows, `width * height * 4` bytes.
 * A picture of any other length is an error, not an `ImageData` that throws on its own, and so
 * is a webview that gives no 2D canvas.
 */
export function paintPixels(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  bytes: Uint8Array
): void {
  if (bytes.length !== width * height * BYTES_PER_PIXEL) {
    throw new Error(
      `the engine drew ${bytes.length} bytes for a picture of ${width} by ${height} pixels`
    );
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this webview gives no 2D canvas to draw a page on");
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length);
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
}
