// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The engine reads no clock, so the app writes the `modified` field of every annotation op and of a
// save, as a PDF date: `D:YYYYMMDDHHmmSS`, then the offset from universal time as `+HH'mm'`.

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const YEAR_DIGITS = 4;

const pad = (n: number, digits = 2): string => String(n).padStart(digits, "0");

/**
 * The PDF date of the instant `utcMs` (milliseconds since the epoch) on a clock that is
 * `offsetMinutes` ahead of universal time (behind when negative).
 */
export function formatPdfDate(utcMs: number, offsetMinutes: number): string {
  // The wall clock is the instant moved by the offset, read as if it were universal time.
  const wall = new Date(utcMs + offsetMinutes * MS_PER_MINUTE);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const away = Math.abs(offsetMinutes);
  return (
    `D:${pad(wall.getUTCFullYear(), YEAR_DIGITS)}${pad(wall.getUTCMonth() + 1)}` +
    `${pad(wall.getUTCDate())}${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}` +
    `${pad(wall.getUTCSeconds())}${sign}${pad(Math.floor(away / MINUTES_PER_HOUR))}'` +
    `${pad(away % MINUTES_PER_HOUR)}'`
  );
}

/** The PDF date of `d` on this machine's clock, with its offset from universal time. */
export function pdfDate(d: Date): string {
  // `getTimezoneOffset` counts minutes the clock is behind universal time: the sign is the other way.
  return formatPdfDate(d.getTime(), -d.getTimezoneOffset());
}
