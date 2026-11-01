// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { relativeTime } from "./relative-time";

const now = Date.UTC(2026, 10, 1, 12, 0, 0);
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

test("under_a_minute_and_the_future_are_now", () => {
  expect(relativeTime(now - 59_999, now)).toBe("now");
  expect(relativeTime(now, now)).toBe("now");
  expect(relativeTime(now + hour, now)).toBe("now");
});

test("the_largest_unit_reached_rounded_down", () => {
  expect(relativeTime(now - min, now)).toBe("1 minute ago");
  expect(relativeTime(now - 2 * min - 59_000, now)).toBe("2 minutes ago");
  expect(relativeTime(now - hour + 1, now)).toBe("59 minutes ago");
  expect(relativeTime(now - 3 * hour, now)).toBe("3 hours ago");
  expect(relativeTime(now - day, now)).toBe("yesterday");
  expect(relativeTime(now - 2 * day, now)).toBe("2 days ago");
  expect(relativeTime(now - 7 * day, now)).toBe("last week");
  expect(relativeTime(now - 31 * day, now)).toBe("last month");
  expect(relativeTime(now - 366 * day, now)).toBe("last year");
  expect(relativeTime(now - 3 * 366 * day, now)).toBe("3 years ago");
});
