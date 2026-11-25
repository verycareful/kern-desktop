// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath, WirePdfOpened } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfClose: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
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

beforeEach(() => {
  vi.clearAllMocks();
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.on.mockResolvedValue(() => undefined);
});

const viewer = (props: Partial<Parameters<typeof PdfViewer>[0]> = {}) =>
  render(<PdfViewer tabId="t1" path={FILE} active {...props} />);

test("shows_what_it_is_opening_then_the_file_and_its_page_count", async () => {
  viewer();
  expect(screen.getByTestId("pdf-opening")).toHaveTextContent("Opening book.pdf");
  expect(await screen.findByTestId("pdf-status")).toHaveTextContent("book.pdf: 3 pages");
});

test("a_one_page_file_says_page_not_pages", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 1 }));
  viewer();
  expect(await screen.findByTestId("pdf-status")).toHaveTextContent("book.pdf: 1 page");
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
  expect(await screen.findByTestId("pdf-status")).toBeInTheDocument();
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
  expect(onSettled).toHaveBeenCalledWith({
    ok: false,
    reason: expect.stringContaining("the file is damaged"),
  });
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
  expect(screen.getByTestId("pdf-status")).toBeInTheDocument();
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
