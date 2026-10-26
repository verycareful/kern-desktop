// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Kern's fonts, bundled (the CSP allows no remote origin) and limited to the
// weights the design tokens use (design handoff README, Typography): Outfit
// 400 to 700 for the UI, Quicksand 700 for the wordmark only, IBM Plex Mono
// 400 to 600 for metadata, Sora 400 for the EPUB reading body only. Every
// unicode-range subset is kept; the browser loads only the ones a page uses.
// The woff fallbacks in the packages' CSS are dropped at build time (see
// vite.config.ts): WebKitGTK reads woff2.
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/quicksand/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/sora/400.css";
