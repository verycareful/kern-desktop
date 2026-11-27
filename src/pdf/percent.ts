// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** A fraction of the page as a percentage, to a thousandth of a percent: a page is never drawn large enough to show more. */
export const percent = (fraction: number): string => `${Number((fraction * 100).toFixed(3))}%`;
