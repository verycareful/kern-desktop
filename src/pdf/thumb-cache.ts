// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** A thumbnail is this wide on screen, in CSS pixels. */
export const THUMB_WIDTH = 120;

/** The pictures kept: a thumbnail is about 80 KB, so the cache holds a few megabytes. */
export const THUMB_CACHE_CAP = 200;

/** One drawn thumbnail: RGBA pixels, `width * height * 4` bytes. */
export interface Thumb {
  width: number;
  height: number;
  bytes: Uint8Array;
}

/** The key of a thumbnail: the document, its edit state, the page (from 0) and the pixel width. */
export function thumbKey(handle: number, revision: number, page: number, widthPx: number): string {
  return `${handle}:${revision}:${page}:${widthPx}`;
}

// The thumbnails drawn so far, so scrolling back over a page does not draw it again. The key
// carries the revision, so an edit makes a new key and the old picture is never shown for it; it
// ages out as the least recently used.
export class ThumbCache {
  private readonly entries = new Map<string, Thumb>();
  constructor(private readonly cap = THUMB_CACHE_CAP) {}

  get(key: string): Thumb | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) return undefined;
    // A hit becomes the most recently used.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, thumb: Thumb): void {
    this.entries.delete(key);
    this.entries.set(key, thumb);
    while (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }

  /** Drops every thumbnail of document `handle`. */
  dropDocument(handle: number): void {
    const prefix = `${handle}:`;
    for (const key of [...this.entries.keys()])
      if (key.startsWith(prefix)) this.entries.delete(key);
  }

  /** Drops every thumbnail of page `page` (from 0) of document `handle`, whatever its revision. */
  dropPage(handle: number, page: number): void {
    for (const key of [...this.entries.keys()]) {
      const [h, , p] = key.split(":");
      if (h === String(handle) && p === String(page)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export const thumbCache = new ThumbCache();
