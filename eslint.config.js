// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Kern opens no socket: these globals are errors everywhere in the frontend.
const bannedGlobals = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((name) => ({
  name,
  message: "Kern never touches the network.",
}));

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src-tauri",
      "node_modules",
      "test-results",
      "playwright-report",
      "local",
      "tools",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "*.ts"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-globals": ["error", ...bannedGlobals],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          bannedGlobals.map(({ name, message }) => ({ object, property: name, message }))
        ),
        { object: "navigator", property: "sendBeacon", message: "Kern never touches the network." },
      ],
    },
  },
  {
    // The Tauri API is reached only through the typed wrappers in src/ipc/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ipc/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/api", "@tauri-apps/api/*"],
              message: "Import the Tauri API only from src/ipc/.",
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright fixtures call a parameter named "use", which is not a hook.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  }
);
