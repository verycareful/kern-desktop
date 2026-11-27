// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test, vi } from "vitest";
import { formatPdfDate, pdfDate } from "./pdf-date";

const INSTANT = Date.UTC(2026, 10, 26, 1, 3, 9);

afterEach(() => vi.restoreAllMocks());

test("formats_utc_as_D_plus_0000", () => {
  expect(formatPdfDate(INSTANT, 0)).toBe("D:20261126010309+00'00'");
});

test("formats_a_negative_offset", () => {
  // Five and a half hours behind: the wall clock is the day before.
  expect(formatPdfDate(INSTANT, -330)).toBe("D:20261125193309-05'30'");
});

test("formats_a_positive_offset", () => {
  expect(formatPdfDate(INSTANT, 330)).toBe("D:20261126063309+05'30'");
});

test("pads_every_field", () => {
  expect(formatPdfDate(Date.UTC(2026, 0, 2, 3, 4, 5), 0)).toBe("D:20260102030405+00'00'");
  expect(formatPdfDate(Date.UTC(2026, 0, 2, 3, 4, 5), -60 - 5)).toBe("D:20260102015905-01'05'");
});

test("a_date_is_written_with_the_offset_of_the_local_clock", () => {
  // `getTimezoneOffset` is minutes behind universal time; the date writes minutes ahead.
  const d = new Date(INSTANT);
  vi.spyOn(d, "getTimezoneOffset").mockReturnValue(-330);
  expect(pdfDate(d)).toBe("D:20261126063309+05'30'");
  vi.spyOn(d, "getTimezoneOffset").mockReturnValue(300);
  expect(pdfDate(d)).toBe("D:20261125200309-05'00'");
});
