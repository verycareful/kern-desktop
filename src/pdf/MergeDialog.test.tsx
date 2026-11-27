// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfMerge: vi.fn(),
  pdfJobProgress: vi.fn(),
  pdfCancelJob: vi.fn(),
  pickPdfs: vi.fn(),
  pickSavePdf: vi.fn(),
  openPaths: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { MergeDialog } from "./MergeDialog";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const BOOK = p("/home/a/book.pdf");
const A = p("/home/b/a.pdf");
const B = p("/home/b/b.pdf");
const OUT = p("/home/a/merged.pdf");

const doc = (over: Partial<PdfDoc> = {}): PdfDoc =>
  testDoc({ fileSource: () => ({ path: BOOK, password: "pw" }), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfJobProgress.mockResolvedValue({ running: false, done: 0, total: 0, stage: "" });
  ipc.pdfCancelJob.mockResolvedValue(undefined);
  ipc.pickSavePdf.mockResolvedValue(OUT);
});
afterEach(cleanup);

const rows = () =>
  within(screen.getByRole("list", { name: "PDFs to merge" })).getAllByRole("listitem");
const names = () => rows().map((r) => r.querySelector(".kern-pdf-job-path")?.textContent);

async function addFiles(...files: WirePath[]) {
  ipc.pickPdfs.mockResolvedValueOnce(files);
  fireEvent.click(screen.getByRole("button", { name: "Add PDFs…" }));
  await waitFor(() => expect(rows()).toHaveLength(1 + files.length));
}
async function chooseTarget() {
  fireEvent.click(screen.getByRole("button", { name: /Choose the new file/ }));
  await waitFor(() => expect(screen.getByTestId("pdf-job-target")).toHaveTextContent("merged.pdf"));
}

test("the_list_starts_with_this_pdf_and_needs_a_second_one", () => {
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  expect(names()).toEqual(["book.pdf (this PDF)"]);
  expect(screen.getByText("Merge needs at least two PDFs.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
});

test("merge_joins_the_pdfs_in_the_order_listed_into_the_file_chosen", async () => {
  ipc.pdfMerge.mockResolvedValue(OUT);
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  await addFiles(A, B);
  expect(ipc.pickPdfs).toHaveBeenCalledWith("Choose the PDFs to merge", {
    k: "Utf8",
    v: "/home/a",
  });
  expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  await chooseTarget();
  fireEvent.click(screen.getByRole("button", { name: "Move b.pdf up" }));
  expect(names()).toEqual(["book.pdf (this PDF)", "b.pdf", "a.pdf"]);
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  await screen.findByTestId("pdf-job-done");
  const [sources, out, job] = ipc.pdfMerge.mock.calls[0] as [unknown[], WirePath, number];
  expect(sources).toEqual([{ path: BOOK, password: "pw" }, { path: B }, { path: A }]);
  expect(out).toEqual(OUT);
  expect(job).toBeGreaterThan(0);
});

test("a_pdf_can_be_moved_down_and_taken_out", async () => {
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  await addFiles(A, B);
  fireEvent.click(screen.getByRole("button", { name: "Move book.pdf down" }));
  expect(names()).toEqual(["a.pdf", "book.pdf (this PDF)", "b.pdf"]);
  expect(screen.getByRole("button", { name: "Move a.pdf up" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Take a.pdf out" }));
  expect(names()).toEqual(["book.pdf (this PDF)", "b.pdf"]);
});

test("changes_not_saved_stop_a_merge_that_uses_this_pdf_and_not_one_that_leaves_it_out", async () => {
  render(<MergeDialog doc={doc({ modified: true })} onClose={vi.fn()} />);
  await addFiles(A);
  await chooseTarget();
  expect(screen.getByTestId("pdf-job-blocked")).toHaveTextContent("changes that are not saved");
  expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  await addFiles(B);
  fireEvent.click(screen.getByRole("button", { name: "Take book.pdf out" }));
  expect(screen.queryByTestId("pdf-job-blocked")).toBeNull();
  expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
});

test("a_failed_merge_says_nothing_was_written_and_keeps_the_list", async () => {
  ipc.pdfMerge.mockRejectedValue({
    kind: "WrongPassword",
    message: "a.pdf needs a password",
    path: A,
    details: null,
  });
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  await addFiles(A);
  await chooseTarget();
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  expect(await screen.findByTestId("pdf-job-failed")).toHaveTextContent(
    "Nothing was written. WrongPassword: a.pdf needs a password"
  );
  expect(names()).toEqual(["book.pdf (this PDF)", "a.pdf"]);
});

test("cancel_stops_the_merge_and_says_no_file_was_written", async () => {
  let reject!: (e: unknown) => void;
  ipc.pdfMerge.mockImplementation(() => new Promise((_, r) => (reject = r)));
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  await addFiles(A);
  await chooseTarget();
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  const job = (await waitFor(() => ipc.pdfMerge.mock.calls[0]))?.[2] as number;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job);
  await act(async () =>
    reject({ kind: "Cancelled", message: "cancelled", path: null, details: null })
  );
  expect(await screen.findByTestId("pdf-job-failed")).toHaveTextContent(
    "Cancelled. No file was written."
  );
});

test("closing_the_dialog_while_it_runs_cancels_the_job", async () => {
  ipc.pdfMerge.mockImplementation(() => new Promise(() => undefined));
  const view = render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  await addFiles(A);
  await chooseTarget();
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  const job = (await waitFor(() => ipc.pdfMerge.mock.calls[0]))?.[2] as number;
  view.unmount();
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job);
});

test("a_closed_chooser_adds_nothing", async () => {
  ipc.pickPdfs.mockResolvedValueOnce(null);
  render(<MergeDialog doc={doc()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add PDFs…" }));
  await waitFor(() => expect(ipc.pickPdfs).toHaveBeenCalled());
  expect(rows()).toHaveLength(1);
});
