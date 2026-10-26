// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { render, screen, waitFor } from "@testing-library/react";
import type { WireTheme } from "./ipc/kernkraft";
import App from "./App";

const themeGet = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({ css: ":root{}", fallbacks: [], problems: [] } as unknown as WireTheme)
  )
);

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
  themeGet,
  toWireError: (e: unknown) => e,
}));

test("renders_shell_root", async () => {
  render(<App />);
  expect(screen.getByTestId("shell")).toBeInTheDocument();
  // The hook has settled once it has written the theme the mocked themeGet gave.
  await waitFor(() => expect(document.head.querySelector("style#kern-tokens")).not.toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("shell")).toBeEmptyDOMElement();
});
