// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { OpConflictEvent, WireEntry, WirePath } from "../ipc";
import { dir, entry } from "../files/test-entries";
import { ConflictDialog } from "./ConflictDialog";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const asked = (over: Partial<OpConflictEvent> = {}): OpConflictEvent => ({
  op: 3,
  conflict: 9,
  source: p("/a/x.txt"),
  existing: p("/b/x.txt"),
  source_entry: entry("x.txt", { len: 2048 }, "/a"),
  existing_entry: entry("x.txt", { len: 10 }, "/b"),
  ...over,
});

function show(over: Partial<OpConflictEvent> = {}, waiting = 0) {
  const onAnswer = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConflictDialog
      conflict={asked(over)}
      operation="Copying 2 items to b"
      waiting={waiting}
      onAnswer={onAnswer}
      onCancel={onCancel}
    />
  );
  return { onAnswer, onCancel };
}

afterEach(cleanup);

test("apply_to_all_sent", () => {
  const { onAnswer } = show();
  fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("keep_both", true);
});

test("without_apply_to_all_only_this_conflict_is_answered", () => {
  const { onAnswer } = show();
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("replace", false);
});

test("skip_has_the_focus_and_answers_skip", () => {
  const { onAnswer } = show();
  const skip = screen.getByRole("button", { name: "Skip" });
  expect(skip).toHaveFocus();
  fireEvent.click(skip);
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("skip", false);
});

test("escape_and_the_cancel_button_stop_the_operation_and_answer_nothing", () => {
  const { onAnswer, onCancel } = show();
  fireEvent.keyDown(screen.getByRole("button", { name: "Skip" }), { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel operation" }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onAnswer).not.toHaveBeenCalled();
});

test("both_sides_are_shown_with_their_paths_and_details", () => {
  show();
  const dialog = screen.getByTestId("conflict-dialog");
  expect(dialog).toHaveTextContent("/b/x.txt");
  expect(dialog).toHaveTextContent("/a/x.txt");
  expect(dialog).toHaveTextContent("10 B");
  expect(dialog).toHaveTextContent("2 KB");
  expect(dialog).toHaveTextContent("Copying 2 items to b");
});

test("an_entry_that_could_not_be_read_is_said_so", () => {
  show({ existing_entry: null });
  expect(screen.getByTestId("conflict-dialog")).toHaveTextContent(/could not be read/);
});

test("replacing_a_folder_with_a_folder_says_it_merges", () => {
  const a: WireEntry = dir("d", {}) as WireEntry;
  show({ source_entry: a, existing_entry: a });
  expect(screen.getByTestId("conflict-dialog")).toHaveTextContent(/merges/);
});

test("a_file_over_a_file_does_not_mention_merging", () => {
  show();
  expect(screen.getByTestId("conflict-dialog")).not.toHaveTextContent(/merges/);
});

test("other_operations_waiting_for_an_answer_are_counted", () => {
  show({}, 2);
  expect(screen.getByRole("status")).toHaveTextContent("2 other operations");
});

test("the_dialog_is_modal_and_labelled", () => {
  show();
  const dialog = screen.getByRole("alertdialog", { name: "Name already taken" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
});

test("tab_stays_inside_the_dialog", () => {
  show();
  const cancel = screen.getByRole("button", { name: "Cancel operation" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  // The last control wraps to the first (the check box), which is the first tabbable.
  expect(screen.getByRole("checkbox", { name: "Apply to all" })).toHaveFocus();
});
