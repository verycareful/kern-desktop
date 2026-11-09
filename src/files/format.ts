// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

import type { TimeFormat } from "../ipc";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** "812 B", "48 KB", "2.6 MB", "3.0 GB": binary units, as the handoff README's size rule. */
export function formatSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (Math.round(bytes / KB) < KB) return `${Math.round(bytes / KB)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A calendar day number that is immune to daylight-saving shifts.
const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;

// A 24-hour clock writes the hour with two digits (09:05), a 12-hour clock without (9:05 AM), and
// the system choice leaves both to the locale. "h23" is midnight as 00, which "h24" is not.
const CLOCK_OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions> = {
  system: { hour: "numeric", minute: "2-digit" },
  "12": { hour: "numeric", minute: "2-digit", hourCycle: "h12" },
  "24": { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
};

const clocks = new Map<TimeFormat, Intl.DateTimeFormat>();

/** The time of day of `d`; the narrow no-break space ICU puts before AM or PM is a plain space. */
function timeOfDay(d: Date, format: TimeFormat): string {
  let clock = clocks.get(format);
  if (!clock) {
    clock = new Intl.DateTimeFormat(undefined, CLOCK_OPTIONS[format]);
    clocks.set(format, clock);
  }
  return clock.format(d).replace(/[\u202f\u00a0]/g, " ");
}

/**
 * A date with its time: Today, Yesterday or "N days ago" within a week, else "Mon D" (with the
 * year when it is not this one), then the time of day. A date in the future is shown as a date.
 * Local time.
 */
export function formatDate(
  ms: number | null,
  now: Date = new Date(),
  format: TimeFormat = "system"
): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const days = dayNumber(now) - dayNumber(d);
  let day: string;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Yesterday";
  else if (days >= 2 && days < 7) day = `${days} days ago`;
  else {
    const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    day = d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
  }
  return `${day} ${timeOfDay(d, format)}`;
}
