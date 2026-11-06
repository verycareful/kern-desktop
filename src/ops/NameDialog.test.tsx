// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NameDialog } from "./NameDialog";

function show(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onCancel = vi.fn();
  render(
    <NameDialog
      title="New folder"
      initial="New folder"
      confirmLabel="Create"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
  return {
    onSubmit,
    onCancel,
    input: screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement,
  };
}

afterEach(cleanup);

test("the_name_is_selected_and_has_the_focus", () => {
  const { input } = show();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe("New folder".length);
});

test("enter_and_the_button_send_the_typed_name_as_it_is", async () => {
  const { onSubmit, input } = show();
  fireEvent.change(input, { target: { value: " docs " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(" docs "));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
});

test.each([
  ["", /empty/i],
  ["a/b", /\//],
  ["a\0b", /NUL/],
  [".", /"\."/],
  ["..", /"\.\."/],
])("the_name_%j_is_refused_before_anything_is_sent", async (name, why) => {
  const { onSubmit, input } = show();
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(why);
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a_refusal_from_the_backend_is_shown_and_the_dialog_stays_for_another_try", async () => {
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce({
      kind: "Exists",
      message: "/d/x already exists",
      path: null,
      details: null,
    })
    .mockResolvedValue(undefined);
  const { input } = show(onSubmit);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Exists: /d/x already exists");
  expect(input).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(input, { target: { value: "y" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("escape_and_cancel_close_without_sending", () => {
  const { onSubmit, onCancel, input } = show();
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a_second_enter_while_the_first_is_sending_sends_nothing_more", async () => {
  let release!: () => void;
  const onSubmit = vi.fn(() => new Promise<void>((r) => (release = r)));
  const { input } = show(onSubmit);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  release();
});
