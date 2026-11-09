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

const NOW = new Date(2026, 9, 26, 15, 30); // Oct 26 2026, local
const at = (d: number, h = 12, m = 0) => new Date(2026, 9, 26 - d, h, m).getTime();

test("a_date_is_a_day_within_a_week_then_the_calendar_date_with_the_time", () => {
  expect(formatDate(at(0, 9, 5), NOW, "24")).toBe("Today 09:05");
  expect(formatDate(at(1, 18, 45), NOW, "24")).toBe("Yesterday 18:45");
  expect(formatDate(at(2), NOW, "24")).toBe("2 days ago 12:00");
  expect(formatDate(at(6), NOW, "24")).toBe("6 days ago 12:00");
  // A week or more is the date: "2w ago" with a time would not say which day.
  expect(formatDate(at(7), NOW, "24")).toBe("Oct 19 12:00");
  expect(formatDate(at(20), NOW, "24")).toBe("Oct 6 12:00");
  expect(formatDate(at(30), NOW, "24")).toBe("Sep 26 12:00");
  expect(formatDate(new Date(2025, 2, 4, 10, 7).getTime(), NOW, "24")).toBe("Mar 4, 2025 10:07");
  expect(formatDate(null, NOW, "24")).toBe("");
  // A time in the future (clock skew) is not "Today" by accident: it is shown by date.
  expect(formatDate(new Date(2026, 9, 28, 10).getTime(), NOW, "24")).toBe("Oct 28 10:00");
});

test("the_twelve_hour_clock_has_no_leading_zero_and_a_plain_space_before_the_marker", () => {
  // The marker's case is the locale's (AM or am), so the text is compared in lower case.
  const twelve = (ms: number) => formatDate(ms, NOW, "12").toLowerCase();
  expect(twelve(at(0, 9, 5))).toBe("today 9:05 am");
  expect(twelve(at(0, 14, 32))).toBe("today 2:32 pm");
  expect(twelve(at(1, 0, 10))).toBe("yesterday 12:10 am");
  expect(twelve(at(0, 12, 0))).toBe("today 12:00 pm");
});

test("the_twenty_four_hour_clock_writes_midnight_as_00", () => {
  expect(formatDate(at(1, 0, 10), NOW, "24")).toBe("Yesterday 00:10");
  expect(formatDate(at(0, 23, 59), NOW, "24")).toBe("Today 23:59");
});

test("the_system_clock_is_the_locales_own_way_of_writing_the_time", () => {
  const expected = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(at(0, 14, 32)))
    .replace(/[\u202f\u00a0]/g, " ");
  expect(formatDate(at(0, 14, 32), NOW, "system")).toBe(`Today ${expected}`);
  expect(formatDate(at(0, 14, 32), NOW)).toBe(`Today ${expected}`);
});
