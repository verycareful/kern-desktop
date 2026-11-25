// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { THUMB_CACHE_CAP, ThumbCache, thumbCache, thumbKey, type Thumb } from "./thumb-cache";

const thumb = (n: number): Thumb => ({ width: 1, height: 1, bytes: new Uint8Array([n, 0, 0, 0]) });

test("the_cap_is_200", () => {
  expect(THUMB_CACHE_CAP).toBe(200);
  expect(thumbCache.size).toBe(0);
});

test("evicts_the_least_recently_used_over_the_cap", () => {
  const cache = new ThumbCache(3);
  cache.set("a", thumb(1));
  cache.set("b", thumb(2));
  cache.set("c", thumb(3));
  // Reading `a` makes `b` the oldest.
  expect(cache.get("a")).toEqual(thumb(1));
  cache.set("d", thumb(4));
  expect(cache.size).toBe(3);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
  expect(cache.get("d")).toBeDefined();
});

test("setting_a_key_again_replaces_it_and_keeps_the_count", () => {
  const cache = new ThumbCache(2);
  cache.set("a", thumb(1));
  cache.set("a", thumb(9));
  expect(cache.size).toBe(1);
  expect(cache.get("a")).toEqual(thumb(9));
});

test("a_new_revision_misses", () => {
  const cache = new ThumbCache();
  cache.set(thumbKey(3, 0, 5, 120), thumb(1));
  expect(cache.get(thumbKey(3, 0, 5, 120))).toBeDefined();
  expect(cache.get(thumbKey(3, 1, 5, 120))).toBeUndefined();
  expect(cache.get(thumbKey(3, 0, 5, 240))).toBeUndefined();
  expect(cache.get(thumbKey(3, 0, 6, 120))).toBeUndefined();
  expect(cache.get(thumbKey(4, 0, 5, 120))).toBeUndefined();
});

test("a_closed_document_drops_only_its_own_thumbnails", () => {
  const cache = new ThumbCache();
  cache.set(thumbKey(3, 0, 0, 120), thumb(1));
  cache.set(thumbKey(3, 2, 7, 120), thumb(2));
  cache.set(thumbKey(30, 0, 0, 120), thumb(3));
  cache.dropDocument(3);
  expect(cache.size).toBe(1);
  expect(cache.get(thumbKey(30, 0, 0, 120))).toBeDefined();
});

test("a_changed_page_drops_its_thumbnails_of_every_revision_and_width_and_no_other", () => {
  const cache = new ThumbCache();
  cache.set(thumbKey(3, 0, 5, 120), thumb(1));
  cache.set(thumbKey(3, 4, 5, 240), thumb(2));
  cache.set(thumbKey(3, 0, 50, 120), thumb(3));
  cache.set(thumbKey(3, 0, 6, 120), thumb(4));
  cache.set(thumbKey(30, 0, 5, 120), thumb(5));
  cache.dropPage(3, 5);
  // Page 50 and document 30 share the digits of page 5 and document 3, and are not it.
  expect(cache.size).toBe(3);
  expect(cache.get(thumbKey(3, 0, 50, 120))).toBeDefined();
  expect(cache.get(thumbKey(3, 0, 6, 120))).toBeDefined();
  expect(cache.get(thumbKey(30, 0, 5, 120))).toBeDefined();
});
