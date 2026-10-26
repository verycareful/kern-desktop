// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// The @fontsource stylesheets list a woff fallback after each woff2 source.
// WebKitGTK supports woff2, so the fallback is removed before Vite resolves
// the urls, and no .woff file reaches the bundle. The plugin fails the build
// rather than ship woff if the packages' CSS stops matching what it removes.
const WOFF_FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g;
const WOFF_LEFT = /\.woff(?!2)\b|format\(\s*['"]woff['"]\s*\)/;
const WOFF2_URL = /\.woff2\b/;

export function woff2Only(): Plugin {
  return {
    name: "kern-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].*\.css$/.test(id)) return null;
      const out = code.replace(WOFF_FALLBACK, "");
      if (WOFF_LEFT.test(out)) {
        this.error(`${id}: a woff source remains after the fallback was removed; update woff2Only`);
      }
      if (!WOFF2_URL.test(out)) {
        this.error(`${id}: no woff2 source found; update woff2Only`);
      }
      return { code: out, map: null };
    },
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/\.woff$/.test(name))
          this.error(`${name}: a woff file was emitted; Kern ships woff2 only`);
      }
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
