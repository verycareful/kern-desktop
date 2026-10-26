// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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

/**
 * The handoff README's relative dates: Today, Yesterday, "N days ago" up to a
 * week, "Nw ago" under 30 days, else "Mon D" (with the year when it is not
 * this one). A date in the future is shown as a date. Local time.
 */
export function formatDate(ms: number | null, now: Date = new Date()): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const days = dayNumber(now) - dayNumber(d);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days >= 2 && days < 7) return `${days} days ago`;
  if (days >= 7 && days < 30) return `${Math.floor(days / 7)}w ago`;
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}
