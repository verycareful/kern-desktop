// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// Reads the pixels of a PNG screenshot: 8-bit RGB or RGBA, not interlaced, which is what the
// window driver sends.

import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** The colour at (x, y) as "r,g,b", the alpha dropped. */
  at(x: number, y: number): string;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(png: Buffer): Pixels {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || body[12] !== 0) {
        throw new Error(`PNG of depth ${depth}, colour type ${colour}, interlace ${body[12]}`);
      }
      channels = colour === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels]! : 0;
      const base = line[x]!;
      let value: number;
      switch (filter) {
        case 0:
          value = base;
          break;
        case 1:
          value = base + left;
          break;
        case 2:
          value = base + up;
          break;
        case 3:
          value = base + ((left + up) >> 1);
          break;
        case 4:
          value = base + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG filter ${filter}`);
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = y * stride + x * channels;
      return `${out[i]},${out[i + 1]},${out[i + 2]}`;
    },
  };
}
