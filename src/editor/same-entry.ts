// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";

/**
 * Whether what is at a path is still what the user was shown: the same kind, size and
 * modification time. A file rewritten in the same millisecond to the same size is not told
 * apart; the modification time is the finest the backend reports.
 */
export const sameEntry = (a: WireEntry, b: WireEntry): boolean =>
  a.kind === b.kind && a.len === b.len && a.modified_ms === b.modified_ms;
