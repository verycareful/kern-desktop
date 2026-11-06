// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PruneReport } from "../ipc";

/** What prune answers when nothing is pinned or recent, for tests of windows that show the panel. */
export const EMPTY_PRUNE: PruneReport = {
  pins_removed: [],
  recents_removed: [],
  errors: [],
  corrupt: [],
  pins: { entries: [] },
  recents: { entries: [] },
};
