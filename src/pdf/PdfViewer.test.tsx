// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath, WirePdfOpened } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfPageInfo: vi.fn(),
  pdfClose: vi.fn(),
  pdfApply: vi.fn(),
  pdfCompactFile: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  on: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { usePdfFind } from "./pdf-find";
import { useLinkPrompt } from "./pdf-link-prompt";
import { usePdfView } from "./pdf-view";
import { EVENT_DIR_CHANGED } from "../ipc";
import { pdfController } from "./pdf-controller";
import { PdfViewer } from "./PdfViewer";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");

const opened = (over: Partial<WirePdfOpened> = {}): WirePdfOpened => ({
  handle: 11,
  pages: 3,
  revision: 0,
  stamp: "s1:opened",
  ...over,
});
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

let disk: "same" | "changed" | "deleted";
let handlers: Record<string, (payload: unknown) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  useOps.setState({ notice: null });
  usePdfView.setState({ byTab: {} });
  usePdfFind.setState({ byTab: {} });
  useLinkPrompt.setState({ byTab: {} });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.pdfPageInfo.mockResolvedValue({
    width_pt: 612,
    height_pt: 792,
    rotate: 0,
    crop_box: [0, 0, 612, 792],
  });
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.on.mockImplementation(async (name: string, handler: (payload: unknown) => void) => {
    handlers[name] = handler;
    return () => undefined;
  });
  ipc.textCheck.mockImplementation(async () => disk);
  ipc.entryOf.mockRejectedValue(wireError("NotFound"));
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.pdfCompactFile.mockResolvedValue(undefined);
  disk = "same";
  handlers = {};
});

const viewer = (props: Partial<Parameters<typeof PdfViewer>[0]> = {}) =>
  render(<PdfViewer tabId="t1" path={FILE} active {...props} />);

test("shows_what_it_is_opening_then_a_page_box_for_every_page", async () => {
  viewer();
  expect(screen.getByTestId("pdf-opening")).toHaveTextContent("Opening book.pdf");
  expect(await screen.findByTestId("pdf-pages")).toBeInTheDocument();
  expect(screen.getAllByRole("group", { name: /^Page \d$/ })).toHaveLength(3);
  expect(usePdfView.getState().byTab["t1"]).toMatchObject({ page: 0, pages: 3 });
});

test("a_one_page_file_has_one_page_box_and_counts_one_page", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 1 }));
  viewer();
  expect(await screen.findByTestId("pdf-pages")).toBeInTheDocument();
  expect(screen.getAllByRole("group", { name: /^Page \d$/ })).toHaveLength(1);
  expect(usePdfView.getState().byTab["t1"]?.pages).toBe(1);
});

test("a_file_with_zero_pages_shows_an_empty_state", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 0 }));
  viewer();
  expect(await screen.findByTestId("pdf-empty")).toHaveTextContent("book.pdf has no pages");
});

test("shows_the_password_prompt_for_an_encrypted_file", async () => {
  ipc.pdfOpen.mockImplementation(async (_path: WirePath, password?: string) => {
    if (password === "right") return opened();
    throw wireError("WrongPassword");
  });
  viewer();
  const prompt = await screen.findByTestId("password-prompt");
  expect(prompt).toHaveTextContent("book.pdf is password protected");
  // The first ask does not say a password was wrong.
  expect(screen.queryByText("That password does not open the file.")).toBeNull();

  const field = screen.getByLabelText("Password");
  expect(field).toHaveAttribute("type", "password");
  fireEvent.change(field, { target: { value: "wrong" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(await screen.findByText("That password does not open the file.")).toBeInTheDocument();
  expect(ipc.pdfOpen).toHaveBeenLastCalledWith(FILE, "wrong");

  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "right" } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByTestId("pdf-pages")).toBeInTheDocument();
  expect(screen.queryByTestId("password-prompt")).toBeNull();
});

test("cancelling_the_password_fails_the_tab_with_the_reason", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("WrongPassword"));
  const onSettled = vi.fn();
  viewer({ onSettled });
  await screen.findByTestId("password-prompt");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByTestId("pdf-failed")).toHaveTextContent("book.pdf could not be opened");
  expect(screen.queryByTestId("password-prompt")).toBeNull();
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledWith({
    ok: false,
    reason: expect.stringContaining("book.pdf could not be opened"),
  });
});

test("a_corrupt_file_shows_the_error_and_settles_as_failed", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("Invalid", "the file is damaged"));
  const onSettled = vi.fn();
  viewer({ onSettled });
  expect(await screen.findByTestId("pdf-failed")).toHaveTextContent("the file is damaged");
  // The window is told from an effect that runs after the failed note is drawn.
  await waitFor(() =>
    expect(onSettled).toHaveBeenCalledWith({
      ok: false,
      reason: expect.stringContaining("the file is damaged"),
    })
  );
});

test("settles_ok_once_the_document_is_registered_as_open", async () => {
  const onSettled = vi.fn();
  viewer({ onSettled });
  await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ ok: true }));
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test("settles_as_failed_when_the_backend_refuses_the_registration", async () => {
  ipc.docOpened.mockRejectedValue(wireError("Ipc", "no"));
  const onSettled = vi.fn();
  viewer({ onSettled });
  await waitFor(() =>
    expect(onSettled).toHaveBeenCalledWith({
      ok: false,
      reason: "the document could not be registered as open in this window",
    })
  );
});

test("a_file_open_elsewhere_carries_the_read_only_banner", async () => {
  ipc.docOpened.mockRejectedValue(wireError("AlreadyOpen", "open in editor-2"));
  viewer();
  expect(await screen.findByTestId("read-only-banner")).toBeInTheDocument();
  expect(screen.getByTestId("pdf-pages")).toBeInTheDocument();
});

test("a_tab_that_is_not_shown_stays_open_and_hidden", async () => {
  viewer({ active: false });
  const section = await screen.findByTestId("pdf-viewer");
  expect(section).not.toBeVisible();
  await waitFor(() => expect(ipc.pdfOpen).toHaveBeenCalledTimes(1));
});

test("a_tab_not_shown_does_not_ask_for_the_password_over_the_tab_that_is", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("WrongPassword"));
  viewer({ active: false });
  await act(async () => undefined);
  await waitFor(() => expect(ipc.pdfOpen).toHaveBeenCalled());
  expect(screen.queryByTestId("password-prompt")).toBeNull();
});

test.each(["RebuiltNotEditable", "RevisionNotEditable"])(
  "a_file_refused_as_%s_offers_a_compacted_copy_that_is_written_from_the_file",
  async (kind) => {
    ipc.pdfOpen.mockRejectedValue(wireError(kind, "cannot edit in place"));
    viewer();
    const failed = await screen.findByTestId("pdf-failed");
    expect(failed).toHaveTextContent("book.pdf could not be opened");
    fireEvent.click(within(failed).getByRole("button", { name: "Save a compacted copy…" }));

    const field = await screen.findByLabelText("Path of the new file");
    expect(field).toHaveValue("/home/a/book_compacted.pdf");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(ipc.pdfCompactFile).toHaveBeenCalledWith(
        { path: FILE, password: undefined },
        p("/home/a/book_compacted.pdf")
      )
    );
    await waitFor(() => expect(screen.queryByTestId("save-as-dialog")).toBeNull());
  }
);

test("other_failures_offer_no_compacted_copy", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("BadHeader"));
  viewer();
  const failed = await screen.findByTestId("pdf-failed");
  expect(within(failed).queryByRole("button")).toBeNull();
});

test("a_file_changed_by_another_program_shows_the_banner_and_reload_reads_it_again", async () => {
  viewer();
  await screen.findByTestId("pdf-pages");
  await waitFor(() => expect(handlers[EVENT_DIR_CHANGED]).toBeDefined());
  expect(screen.queryByTestId("pdf-changed-banner")).toBeNull();
  disk = "changed";
  await act(async () => handlers[EVENT_DIR_CHANGED]?.({ key: "doc:t1" }));
  const banner = await screen.findByTestId("pdf-changed-banner");

  ipc.pdfOpen.mockResolvedValue(opened({ handle: 12, stamp: "s9:new" }));
  disk = "same";
  fireEvent.click(within(banner).getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(screen.queryByTestId("pdf-changed-banner")).toBeNull());
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(2);
});

test("a_file_deleted_on_disk_shows_its_banner_without_reload", async () => {
  viewer();
  await screen.findByTestId("pdf-pages");
  await waitFor(() => expect(handlers[EVENT_DIR_CHANGED]).toBeDefined());
  disk = "deleted";
  await act(async () => handlers[EVENT_DIR_CHANGED]?.({ key: "doc:t1" }));
  const banner = await screen.findByTestId("pdf-gone-banner");
  expect(within(banner).queryByRole("button", { name: /reload/i })).toBeNull();
});

test("the_first_edit_asks_about_a_copy_and_goes_on_when_the_user_says_so", async () => {
  ipc.pdfApply.mockResolvedValue({
    revision: 1,
    pages: 3,
    changed_pages: [0],
    can_undo: true,
    can_redo: false,
    modified: true,
  });
  viewer();
  await screen.findByTestId("pdf-pages");
  await waitFor(() => expect(pdfController("t1")).toBeDefined());
  act(() => pdfController("t1")?.rotate(90, "page"));
  const prompt = await screen.findByTestId("copy-first-prompt");
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  fireEvent.click(within(prompt).getByRole("button", { name: "Edit without a copy" }));
  await waitFor(() => expect(ipc.pdfApply).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("copy-first-prompt")).toBeNull();
});

test("cancelling_the_copy_question_leaves_the_pdf_as_it_was", async () => {
  viewer();
  await screen.findByTestId("pdf-pages");
  await waitFor(() => expect(pdfController("t1")).toBeDefined());
  act(() => pdfController("t1")?.rotate(90, "page"));
  const prompt = await screen.findByTestId("copy-first-prompt");
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByTestId("copy-first-prompt")).toBeNull());
  expect(ipc.pdfApply).not.toHaveBeenCalled();
});

test("the_find_bar_stands_above_the_pages_while_it_is_open_and_never_before_them", async () => {
  viewer();
  await screen.findByTestId("pdf-pages");
  expect(screen.queryByTestId("pdf-find")).toBeNull();
  act(() => pdfController("t1")?.openFind());
  const bar = await screen.findByTestId("pdf-find");
  expect(bar.compareDocumentPosition(screen.getByTestId("pdf-scroll"))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  expect(document.activeElement).toBe(within(bar).getByRole("searchbox", { name: "Find" }));
});

test("a_link_asks_in_the_prompt_of_the_tab_that_is_in_front_and_closing_the_tab_forgets_it", async () => {
  const view = viewer();
  await screen.findByTestId("pdf-pages");
  act(() => useLinkPrompt.getState().ask("t1", "https://example.org/"));
  expect(await screen.findByTestId("link-address")).toHaveTextContent("https://example.org/");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByTestId("link-prompt")).toBeNull();
  expect(useLinkPrompt.getState().byTab["t1"]).toBeUndefined();
  act(() => useLinkPrompt.getState().ask("t1", "tel:1"));
  view.unmount();
  expect(useLinkPrompt.getState().byTab["t1"]).toBeUndefined();
});

test("a_link_asked_of_a_tab_behind_another_waits_for_it_to_come_to_the_front", async () => {
  viewer({ active: false });
  await waitFor(() => expect(ipc.pdfOpen).toHaveBeenCalled());
  act(() => useLinkPrompt.getState().ask("t1", "https://example.org/"));
  expect(screen.queryByTestId("link-prompt")).toBeNull();
});
