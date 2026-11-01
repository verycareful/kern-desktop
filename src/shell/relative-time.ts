// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Design 4.1: a recent entry shows when it was opened as a relative time
// ("2 minutes ago", "yesterday"), so entries with the same name are told
// apart. The unit is the largest one the age reaches; the number is rounded
// down, so an entry is never shown as more recent than it is.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The mean Gregorian month and year (365.2425 days), for an age, not a calendar date. */
const YEAR = 365.2425 * DAY;
const MONTH = YEAR / 12;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

const format = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** How long ago `ms` (milliseconds since the Unix epoch) was, seen from `now`. Under a minute, and any time after `now` (a clock set back), is "now". */
export function relativeTime(ms: number, now: number): string {
  const age = now - ms;
  for (const [unit, size] of UNITS) {
    if (age >= size) return format.format(-Math.floor(age / size), unit);
  }
  return format.format(0, "second");
}

/** How often a shown relative time is worked out again: its smallest unit. */
export const RELATIVE_TIME_TICK_MS = MINUTE;
