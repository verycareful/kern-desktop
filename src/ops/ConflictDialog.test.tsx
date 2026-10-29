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

function show(over: Partial<OpConflictEvent> = {}, waiting = 0, others = 0) {
  const onAnswer = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConflictDialog
      conflict={asked(over)}
      operation="Copying 2 items to b"
      waiting={waiting}
      others={others}
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

/** The note the Replace button is described by. */
function replaceNote() {
  const replace = screen.getByRole("button", { name: "Replace" });
  const note = document.getElementById(replace.getAttribute("aria-describedby")!);
  expect(screen.getByTestId("conflict-dialog")).toContainElement(note);
  return note!;
}

const folder = (): WireEntry => dir("d", {}) as WireEntry;

test("replacing_a_file_with_a_file_says_what_is_there_is_lost_and_cannot_be_undone", () => {
  show();
  const note = replaceNote();
  expect(note).toHaveTextContent(/already there is lost/i);
  expect(note).toHaveTextContent(/cannot be undone/i);
  expect(note).not.toHaveTextContent(/merge/i);
});

test("replacing_a_folder_with_a_folder_says_the_folders_are_merged_and_the_clashes_inside_are_asked", () => {
  show({ source_entry: folder(), existing_entry: folder() });
  const note = replaceNote();
  expect(note).toHaveTextContent(/folders are merged/i);
  expect(note).toHaveTextContent(/inside .* asked about/i);
  expect(note).toHaveTextContent(/merge cannot be undone/i);
  // Nothing is lost by the merge itself, so "lost" must not be said of the folder.
  expect(note).not.toHaveTextContent(/lost/i);
});

test("a_folder_against_a_file_is_not_replaced_and_nothing_is_lost", () => {
  for (const sides of [
    { source_entry: folder(), existing_entry: entry("d", { len: 1 }, "/b") },
    { source_entry: entry("d", { len: 1 }, "/a"), existing_entry: folder() },
  ]) {
    show(sides);
    const note = replaceNote();
    expect(note).toHaveTextContent(/does not put a folder over a file or a file over a folder/i);
    expect(note).toHaveTextContent(/nothing .* changed/i);
    expect(note).not.toHaveTextContent(/is lost/i);
    cleanup();
  }
});

test("a_link_to_a_folder_is_not_a_folder_for_replacing_because_the_link_itself_is_replaced", () => {
  // The conflict is judged on the entries themselves, links not followed.
  const link = entry("d", { kind: "symlink", target_is_dir: true }, "/a");
  show({ source_entry: link, existing_entry: entry("d", { len: 1 }, "/b") });
  expect(replaceNote()).toHaveTextContent(/already there is lost/i);
});

test("when_a_side_could_not_be_read_the_note_says_both_things_that_can_happen", () => {
  show({ existing_entry: null });
  const note = replaceNote();
  expect(note).toHaveTextContent(/lost/i);
  expect(note).toHaveTextContent(/merged/i);
  expect(note).toHaveTextContent(/cannot be undone/i);
});

test("apply_to_all_says_it_is_this_operations_when_others_are_in_flight", () => {
  show({}, 0, 1);
  expect(
    screen.getByRole("checkbox", { name: "Apply to all in this operation" })
  ).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Apply to all" })).toBeNull();
});

test("apply_to_all_is_plain_when_this_is_the_only_operation", () => {
  show();
  expect(screen.getByRole("checkbox", { name: "Apply to all" })).toBeInTheDocument();
});

test("apply_to_all_in_this_operation_is_sent_as_apply_to_all", () => {
  const { onAnswer } = show({}, 1, 2);
  fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all in this operation" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("skip", true);
});
