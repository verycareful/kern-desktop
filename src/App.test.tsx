// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders_shell_root", () => {
  render(<App />);
  expect(screen.getByTestId("shell")).toBeInTheDocument();
});
