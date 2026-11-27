// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";
import { PdfChangedBanner } from "./PdfChangedBanner";
import { compactedName } from "./compacted-name";
import { PdfPrompts } from "./PdfPrompts";
import { testDoc } from "./test-doc";

const FILE: WirePath = { k: "Utf8", v: "/home/a/book.pdf" };

test("the_suggested_name_of_a_compacted_copy_keeps_the_folder_and_the_extension", () => {
  expect(compactedName("/home/a/book.pdf")).toBe("/home/a/book_compacted.pdf");
  expect(compactedName("/home/a/Book.PDF")).toBe("/home/a/Book_compacted.PDF");
  expect(compactedName("/home/a/book")).toBe("/home/a/book_compacted.pdf");
});

test("nothing_shows_while_no_question_is_open", () => {
  const { container } = render(<PdfPrompts path={FILE} doc={testDoc()} />);
  expect(container).toBeEmptyDOMElement();
});

test("the_external_question_speaks_of_the_changes_to_a_pdf_and_each_answer_is_its_own", () => {
  const doc = testDoc({
    prompt: "external",
    modified: true,
    reload: vi.fn(async () => undefined),
    overwrite: vi.fn(async () => undefined),
    askSaveAs: vi.fn(),
    cancelPrompt: vi.fn(),
  });
  render(<PdfPrompts path={FILE} doc={doc} />);
  const prompt = screen.getByTestId("external-prompt");
  expect(prompt).toHaveTextContent("Your changes were not saved.");
  expect(prompt).toHaveTextContent("discards your unsaved changes");
  expect(prompt).not.toHaveTextContent("your text");
  // The safe answer has the focus.
  expect(within(prompt).getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(within(prompt).getByRole("button", { name: "Reload" }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Overwrite" }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Save As…" }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  expect(doc.reload).toHaveBeenCalledTimes(1);
  expect(doc.overwrite).toHaveBeenCalledTimes(1);
  expect(doc.askSaveAs).toHaveBeenCalledTimes(1);
  expect(doc.cancelPrompt).toHaveBeenCalledTimes(1);
});

test("the_deleted_question_offers_to_create_the_file_again", () => {
  const doc = testDoc({ prompt: "recreate", overwrite: vi.fn(async () => undefined) });
  render(<PdfPrompts path={FILE} doc={doc} />);
  fireEvent.click(screen.getByRole("button", { name: "Create the file again" }));
  expect(doc.overwrite).toHaveBeenCalledTimes(1);
});

test("save_as_asks_for_a_path_and_hands_it_to_the_document", async () => {
  const saveAs = vi.fn(async () => ({ status: "saved" as const }));
  render(<PdfPrompts path={FILE} doc={testDoc({ prompt: "saveAs", saveAs })} />);
  const field = screen.getByLabelText("Path of the new file");
  expect(field).toHaveValue("/home/a/book.pdf");
  fireEvent.change(field, { target: { value: "/home/a/novel.pdf" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() =>
    expect(saveAs).toHaveBeenCalledWith({ k: "Utf8", v: "/home/a/novel.pdf" }, null)
  );
});

test("a_compacted_copy_starts_from_a_new_name_and_says_what_it_is", async () => {
  const saveCompactedCopy = vi.fn(async () => ({ status: "saved" as const }));
  render(<PdfPrompts path={FILE} doc={testDoc({ prompt: "compact", saveCompactedCopy })} />);
  const dialog = screen.getByTestId("save-as-dialog");
  expect(within(dialog).getByRole("heading")).toHaveTextContent("Save a compacted copy");
  expect(dialog).toHaveTextContent("a new file");
  const field = screen.getByLabelText("Path of the new file");
  expect(field).toHaveValue("/home/a/book_compacted.pdf");
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() =>
    expect(saveCompactedCopy).toHaveBeenCalledWith({ k: "Utf8", v: "/home/a/book_compacted.pdf" })
  );
});

test("the_copy_question_puts_cancel_first_and_each_choice_is_passed_on", () => {
  const answerCopyFirst = vi.fn(async () => undefined);
  render(<PdfPrompts path={FILE} doc={testDoc({ prompt: "copyFirst", answerCopyFirst })} />);
  const prompt = screen.getByTestId("copy-first-prompt");
  expect(prompt).toHaveTextContent("Keep a copy of book.pdf first?");
  expect(within(prompt).getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(within(prompt).getByRole("button", { name: "Save a copy first" }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Edit without a copy" }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  expect(answerCopyFirst.mock.calls).toEqual([["copy"], ["without"], ["cancel"]]);
});

test("escape_at_the_copy_question_is_cancel", () => {
  const answerCopyFirst = vi.fn(async () => undefined);
  render(<PdfPrompts path={FILE} doc={testDoc({ prompt: "copyFirst", answerCopyFirst })} />);
  fireEvent.keyDown(screen.getByTestId("copy-first-prompt"), { key: "Escape" });
  expect(answerCopyFirst).toHaveBeenCalledExactlyOnceWith("cancel");
});

test("while_the_copy_is_made_no_answer_can_be_given", () => {
  const answerCopyFirst = vi.fn(async () => undefined);
  render(
    <PdfPrompts
      path={FILE}
      doc={testDoc({ prompt: "copyFirst", copying: true, answerCopyFirst })}
    />
  );
  const prompt = screen.getByTestId("copy-first-prompt");
  expect(prompt).toHaveTextContent("Copying…");
  for (const b of within(prompt).getAllByRole("button")) expect(b).toBeDisabled();
  fireEvent.keyDown(prompt, { key: "Escape" });
  expect(answerCopyFirst).not.toHaveBeenCalled();
});

test("reload_names_what_it_throws_away_and_cancel_has_the_focus", () => {
  const doc = testDoc({
    prompt: "reload",
    reload: vi.fn(async () => undefined),
    cancelPrompt: vi.fn(),
  });
  render(<PdfPrompts path={FILE} doc={doc} />);
  const prompt = screen.getByTestId("reload-prompt");
  expect(prompt).toHaveTextContent(
    "The changes you made to it here and did not save are discarded"
  );
  expect(within(prompt).getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(within(prompt).getByRole("button", { name: "Discard my changes and reload" }));
  expect(doc.reload).toHaveBeenCalledTimes(1);
});

test("the_banner_of_a_changed_file_offers_reload_and_save_as", () => {
  const onReload = vi.fn();
  const onSaveAs = vi.fn();
  const { rerender } = render(
    <PdfChangedBanner kind="changed" dirty={false} onReload={onReload} onSaveAs={onSaveAs} />
  );
  const banner = screen.getByTestId("pdf-changed-banner");
  expect(banner).toHaveTextContent("changed on the disk by another program");
  fireEvent.click(within(banner).getByRole("button", { name: "Reload" }));
  fireEvent.click(within(banner).getByRole("button", { name: "Save As…" }));
  expect(onReload).toHaveBeenCalledTimes(1);
  expect(onSaveAs).toHaveBeenCalledTimes(1);
  // With changes made here, the button says what it costs.
  rerender(<PdfChangedBanner kind="changed" dirty onReload={onReload} onSaveAs={onSaveAs} />);
  expect(screen.getByRole("button", { name: "Discard my changes and reload" })).toBeInTheDocument();
});

test("the_banner_of_a_deleted_file_has_no_reload_and_says_saving_creates_it_again", () => {
  render(<PdfChangedBanner kind="gone" dirty onReload={vi.fn()} onSaveAs={vi.fn()} />);
  const banner = screen.getByTestId("pdf-gone-banner");
  expect(banner).toHaveTextContent("saving creates the file again");
  expect(within(banner).queryByRole("button", { name: /reload/i })).toBeNull();
  expect(within(banner).getByRole("button", { name: "Save As…" })).toBeInTheDocument();
});
