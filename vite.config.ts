// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// The @fontsource stylesheets list a woff fallback after each woff2 source.
// WebKitGTK supports woff2, so the fallback is removed before Vite resolves
// the urls, and no .woff file reaches the bundle.
function woff2Only(): Plugin {
  return {
    name: "kern-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].*\.css$/.test(id)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, ""), map: null };
    },
  };
}

// Tauri expects a fixed port and a dev server that leaves src-tauri alone.
export default defineConfig({
  plugins: [react(), woff2Only()],
  clearScreen: false,
  // The CSP's font-src is 'self', which excludes data: URIs, so no font file
  // may be inlined into the CSS however small it is.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
