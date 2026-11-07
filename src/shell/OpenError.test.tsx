// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { WireError } from "../ipc";
import { showOpenErrors, useOpenError } from "../ops/open-error-store";
import { OpenError } from "./OpenError";

// The editor window says one failed open at a time: each open replaces the message, one that
// succeeds clears it, and the dismiss button ends it.

const noApp: WireError = {
  kind: "NoApplication",
  message: "no application opens this file",
  path: null,
  details: null,
};
const gone: WireError = { kind: "NotFound", message: "no such file", path: null, details: null };

afterEach(() => {
  cleanup();
  useOpenError.getState().dismiss();
});

test("nothing_is_shown_until_an_open_fails", () => {
  render(<OpenError />);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_failed_open_names_the_file_and_the_reason", () => {
  render(<OpenError />);
  act(() => showOpenErrors("report.xyz", [noApp]));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "report.xyz was not opened: NoApplication: no application opens this file"
  );
});

test("a_second_failed_open_replaces_the_first_instead_of_stacking", () => {
  render(<OpenError />);
  act(() => showOpenErrors("a.xyz", [noApp]));
  act(() => showOpenErrors("b.xyz", [gone]));
  const alert = screen.getByRole("alert");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(alert).toHaveTextContent("b.xyz was not opened: NotFound: no such file");
  expect(alert).not.toHaveTextContent("a.xyz");
});

test("the_failures_of_one_open_are_one_message_with_a_line_each", () => {
  render(<OpenError />);
  act(() => showOpenErrors("many", [noApp, gone]));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("an_open_that_succeeds_clears_the_message", () => {
  render(<OpenError />);
  act(() => showOpenErrors("a.xyz", [noApp]));
  act(() => showOpenErrors("b.txt", []));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the_dismiss_button_is_the_square_one_and_ends_the_message", () => {
  render(<OpenError />);
  act(() => showOpenErrors("a.xyz", [noApp]));
  const dismiss = screen.getByRole("button", { name: "Dismiss" });
  expect(dismiss).toHaveClass("kern-dismiss");
  fireEvent.click(dismiss);
  expect(screen.queryByRole("alert")).toBeNull();
});
