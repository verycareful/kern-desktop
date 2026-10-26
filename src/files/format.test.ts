// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { formatDate, formatSize } from "./format";

test("sizes_use_binary_units", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1023)).toBe("1023 B");
  expect(formatSize(1024)).toBe("1 KB");
  expect(formatSize(48 * 1024)).toBe("48 KB");
  expect(formatSize(1024 * 1024)).toBe("1.0 MB");
  expect(formatSize(Math.round(2.55 * 1024 * 1024))).toBe("2.6 MB");
  expect(formatSize(3 * 1024 ** 3)).toBe("3.0 GB");
});

test("dates_are_relative_then_absolute", () => {
  const now = new Date(2026, 9, 26, 15, 30); // Oct 26 2026, local
  const at = (d: number, h = 12) => new Date(2026, 9, 26 - d, h, 0).getTime();
  expect(formatDate(at(0, 9), now)).toBe("Today");
  expect(formatDate(at(1), now)).toBe("Yesterday");
  expect(formatDate(at(2), now)).toBe("2 days ago");
  expect(formatDate(at(6), now)).toBe("6 days ago");
  expect(formatDate(at(7), now)).toBe("1w ago");
  expect(formatDate(at(20), now)).toBe("2w ago");
  expect(formatDate(at(30), now)).toBe("Sep 26");
  expect(formatDate(new Date(2025, 2, 4, 10).getTime(), now)).toBe("Mar 4, 2025");
  expect(formatDate(null, now)).toBe("");
  // A time in the future (clock skew) is not "Today" by accident: it is shown by date.
  expect(formatDate(new Date(2026, 9, 28, 10).getTime(), now)).toBe("Oct 28");
});
