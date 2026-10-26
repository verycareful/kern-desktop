// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { render, screen } from "@testing-library/react";
import type { WireTheme } from "./ipc/kernkraft";
import App from "./App";

vi.mock("./ipc", () => ({
  EVENT_THEME_CHANGED: "kernkraft://theme-changed",
  on: () => Promise.resolve(() => undefined),
  settingsGet: () =>
    Promise.resolve({
      follow: { colours: true, accent: true, fonts: true, radius: true },
      theme_mode: "system",
      accent: "slate",
      density: "cozy",
    }),
  themeGet: () =>
    Promise.resolve({ css: ":root{}", fallbacks: [], problems: [] } as unknown as WireTheme),
  toWireError: (e: unknown) => e,
}));

test("renders_shell_root", async () => {
  render(<App />);
  expect(screen.getByTestId("shell")).toBeInTheDocument();
  expect(await screen.findByTestId("shell")).toBeEmptyDOMElement();
});
