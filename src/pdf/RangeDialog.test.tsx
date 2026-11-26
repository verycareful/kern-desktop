// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfExtract: vi.fn(),
  pdfSplit: vi.fn(),
  pdfJobProgress: vi.fn(),
  pdfCancelJob: vi.fn(),
  pickSavePdf: vi.fn(),
  pickFolder: vi.fn(),
  openPaths: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { RangeDialog } from "./RangeDialog";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const BOOK = p("/home/a/book.pdf");
const OUT = p("/home/a/pages.pdf");
const DIR = p("/home/a/parts");

const doc = (over: Partial<PdfDoc> = {}): PdfDoc =>
  testDoc({ pages: 9, fileSource: () => ({ path: BOOK, password: "pw" }), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfJobProgress.mockResolvedValue({ running: false, done: 0, total: 0, stage: "" });
  ipc.pdfCancelJob.mockResolvedValue(undefined);
  ipc.pickSavePdf.mockResolvedValue(OUT);
  ipc.pickFolder.mockResolvedValue(DIR);
});
afterEach(cleanup);

const pagesField = () => screen.getByRole("textbox", { name: /^Pages of 9/ });
const type = (text: string) => fireEvent.change(pagesField(), { target: { value: text } });

async function chooseTarget(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() =>
    expect(screen.getByTestId("pdf-job-target")).not.toHaveTextContent("Nothing")
  );
}

test("extract_writes_the_named_pages_in_the_order_given_to_the_file_chosen", async () => {
  ipc.pdfExtract.mockResolvedValue(OUT);
  render(<RangeDialog mode="extract" doc={doc()} initial="" onClose={vi.fn()} />);
  type("5, 1-3");
  const go = screen.getByRole("button", { name: "Extract" });
  expect(go).toBeDisabled();
  await chooseTarget(/Choose the new file/);
  expect(go).toBeEnabled();
  fireEvent.click(go);
  await screen.findByTestId("pdf-job-done");
  const [source, pages, out, job] = ipc.pdfExtract.mock.calls[0] as [
    unknown,
    number[],
    WirePath,
    number,
  ];
  expect(source).toEqual({ path: BOOK, password: "pw" });
  expect(pages).toEqual([4, 0, 1, 2]);
  expect(out).toEqual(OUT);
  expect(job).toBeGreaterThan(0);
  expect(screen.getByTestId("pdf-job-done")).toHaveTextContent("pages.pdf");
});

test("the_chooser_starts_in_the_files_folder_with_a_name_of_its_own", async () => {
  render(<RangeDialog mode="extract" doc={doc()} initial="" onClose={vi.fn()} />);
  await chooseTarget(/Choose the new file/);
  expect(ipc.pickSavePdf).toHaveBeenCalledWith(
    "Save the extracted pages as",
    { k: "Utf8", v: "/home/a" },
    "book (extract).pdf"
  );
});

test("the_pages_field_starts_with_the_chosen_pages_and_says_what_is_wrong_with_a_range", () => {
  render(<RangeDialog mode="extract" doc={doc()} initial="2-3" onClose={vi.fn()} />);
  expect(pagesField()).toHaveValue("2-3");
  type("0");
  expect(screen.getByRole("note")).toHaveTextContent(
    "Page 0 does not exist. Pages run from 1 to 9."
  );
  type("12");
  expect(screen.getByRole("note")).toHaveTextContent("Page 12 does not exist");
  type("4-2");
  expect(screen.getByRole("note")).toHaveTextContent("4-2 runs backwards. Write it as 2-4.");
  type("1-3,3");
  expect(screen.getByRole("note")).toHaveTextContent("Page 3 is listed twice.");
});

test("extract_is_not_offered_for_pages_that_are_wrong_even_with_a_file_chosen", async () => {
  render(<RangeDialog mode="extract" doc={doc()} initial="" onClose={vi.fn()} />);
  await chooseTarget(/Choose the new file/);
  type("1-3,3");
  expect(screen.getByRole("button", { name: "Extract" })).toBeDisabled();
  type("1-3");
  expect(screen.getByRole("button", { name: "Extract" })).toBeEnabled();
});

test("split_writes_one_file_for_each_range_into_the_folder_chosen", async () => {
  ipc.pdfSplit.mockResolvedValue([p("/home/a/parts/book_1-3.pdf"), p("/home/a/parts/book_5.pdf")]);
  render(<RangeDialog mode="split" doc={doc()} initial="" onClose={vi.fn()} />);
  type("1-3, 5");
  await chooseTarget(/Choose the folder/);
  expect(ipc.pickFolder).toHaveBeenCalledWith("Choose the folder for the new files", {
    k: "Utf8",
    v: "/home/a",
  });
  fireEvent.click(screen.getByRole("button", { name: "Split" }));
  await screen.findByTestId("pdf-job-done");
  expect(ipc.pdfSplit).toHaveBeenCalledWith(
    { path: BOOK, password: "pw" },
    "1-3,5",
    DIR,
    expect.any(Number)
  );
  expect(screen.getByTestId("pdf-job-done")).toHaveTextContent("Wrote 2 files:");
  expect(screen.getByTestId("pdf-job-done")).toHaveTextContent("book_1-3.pdf");
});

test("split_refuses_two_ranges_that_would_write_the_same_file", async () => {
  render(<RangeDialog mode="split" doc={doc()} initial="" onClose={vi.fn()} />);
  await chooseTarget(/Choose the folder/);
  type("5,5-5");
  expect(screen.getByRole("note")).toHaveTextContent("two files would have the same name");
  expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
  type("1-3,2-4");
  expect(screen.getByRole("button", { name: "Split" })).toBeEnabled();
});

test("changes_not_saved_are_not_in_the_file_so_nothing_starts_and_the_reason_is_shown", async () => {
  render(
    <RangeDialog mode="extract" doc={doc({ modified: true })} initial="1" onClose={vi.fn()} />
  );
  await chooseTarget(/Choose the new file/);
  expect(screen.getByTestId("pdf-job-blocked")).toHaveTextContent("changes that are not saved");
  expect(screen.getByRole("button", { name: "Extract" })).toBeDisabled();
  fireEvent.keyDown(pagesField(), { key: "Enter" });
  expect(ipc.pdfExtract).not.toHaveBeenCalled();
});

test("a_file_changed_on_disk_blocks_the_work_as_well", () => {
  render(
    <RangeDialog
      mode="split"
      doc={doc({ externalChange: "changed" })}
      initial="1"
      onClose={vi.fn()}
    />
  );
  expect(screen.getByTestId("pdf-job-blocked")).toHaveTextContent("changed by another program");
});

test("a_file_that_exists_is_refused_by_the_engine_and_the_dialog_says_nothing_was_written", async () => {
  const exists: WireError = {
    kind: "AlreadyExists",
    message: "/home/a/pages.pdf exists",
    path: OUT,
    details: null,
  };
  ipc.pdfExtract.mockRejectedValue(exists);
  render(<RangeDialog mode="extract" doc={doc()} initial="1" onClose={vi.fn()} />);
  await chooseTarget(/Choose the new file/);
  fireEvent.click(screen.getByRole("button", { name: "Extract" }));
  const failed = await screen.findByTestId("pdf-job-failed");
  expect(failed).toHaveTextContent("Nothing was written.");
  expect(failed).toHaveTextContent("AlreadyExists");
  // The form is back, so another name can be chosen.
  expect(screen.getByRole("button", { name: "Extract" })).toBeEnabled();
});

test("a_running_job_shows_its_progress_and_cancel_stops_exactly_that_job", async () => {
  let reject!: (e: unknown) => void;
  ipc.pdfSplit.mockImplementation(() => new Promise((_, r) => (reject = r)));
  ipc.pdfJobProgress.mockResolvedValue({ running: true, done: 1, total: 3, stage: "Splitting" });
  render(<RangeDialog mode="split" doc={doc()} initial="1-2,4" onClose={vi.fn()} />);
  await chooseTarget(/Choose the folder/);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByTestId("pdf-job-progress")).toHaveTextContent("Splitting 1 of 3");
  } finally {
    vi.useRealTimers();
  }
  const job = ipc.pdfSplit.mock.calls[0]?.[3] as number;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job);
  expect(screen.getByTestId("pdf-job-progress")).toHaveTextContent("Cancelling…");
  await act(async () =>
    reject({ kind: "Cancelled", message: "cancelled", path: null, details: null })
  );
  expect(await screen.findByTestId("pdf-job-failed")).toHaveTextContent(
    "Cancelled. No file was written."
  );
});

test("open_it_opens_the_extracted_file_and_closes_the_dialog", async () => {
  ipc.pdfExtract.mockResolvedValue(OUT);
  ipc.openPaths.mockResolvedValue([{ path: OUT, error: null }]);
  const onClose = vi.fn();
  render(<RangeDialog mode="extract" doc={doc()} initial="1" onClose={onClose} />);
  await chooseTarget(/Choose the new file/);
  fireEvent.click(screen.getByRole("button", { name: "Extract" }));
  await screen.findByTestId("pdf-job-done");
  fireEvent.click(screen.getByRole("button", { name: "Open it" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(ipc.openPaths).toHaveBeenCalledWith([OUT], "inside");
});

test("a_closed_chooser_changes_nothing", async () => {
  ipc.pickSavePdf.mockResolvedValue(null);
  render(<RangeDialog mode="extract" doc={doc()} initial="1" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Choose the new file/ }));
  await waitFor(() => expect(ipc.pickSavePdf).toHaveBeenCalled());
  expect(screen.getByTestId("pdf-job-target")).toHaveTextContent("Nothing chosen yet");
});

test("a_chooser_that_fails_says_why", async () => {
  ipc.pickSavePdf.mockRejectedValue({
    kind: "BadPath",
    message: "not a path",
    path: null,
    details: null,
  });
  render(<RangeDialog mode="extract" doc={doc()} initial="1" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Choose the new file/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("BadPath");
});

test("escape_closes_the_dialog_and_does_not_while_the_job_runs", async () => {
  ipc.pdfExtract.mockImplementation(() => new Promise(() => undefined));
  const onClose = vi.fn();
  render(<RangeDialog mode="extract" doc={doc()} initial="1" onClose={onClose} />);
  await chooseTarget(/Choose the new file/);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Extract" }));
  await screen.findByTestId("pdf-job-progress");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
