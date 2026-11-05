// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Settings } from "../ipc";

/**
 * The settings that take effect only when Kern starts: saving a change to one offers Restart to
 * apply. Every setting Kern has applies at once (the theme and the interface size in every window,
 * the rest where it is next read), so the list is empty.
 */
export const NEEDS_RESTART: readonly (keyof Settings)[] = [];
