// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** The page a typed value names, counted from 1, or why it names none. Never clamped. */
export function parsePage(text: string, pages: number): { page: number } | { problem: string } {
  const value = text.trim();
  if (value === "") return { problem: "Enter a page number." };
  if (!/^\d+$/.test(value)) return { problem: "A page number is digits only." };
  const page = Number(value);
  if (page < 1 || page > pages) {
    return { problem: `This file has pages 1 to ${pages.toLocaleString("en-US")}.` };
  }
  return { page };
}
