// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The version label of this build, from the repository's VERSION file
// (every release label is written there), put into the build by Vite.
import text from "../../VERSION?raw";

export const VERSION_LABEL: string = text.trim();
