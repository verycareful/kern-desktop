// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const opener = vi.hoisted(() => ({ openAddress: vi.fn() }));
vi.mock("../ipc/opener", () => opener);

import { LinkPrompt } from "./LinkPrompt";

const URL_LONG = "https://example.org/" + "a".repeat(300) + "?token=1";

beforeEach(() => {
  vi.clearAllMocks();
  opener.openAddress.mockResolvedValue(undefined);
});
afterEach(cleanup);

test("shows_the_whole_address_before_opening", () => {
  render(<LinkPrompt url={URL_LONG} onClose={() => undefined} />);
  expect(screen.getByTestId("link-address").textContent).toBe(URL_LONG);
  expect(opener.openAddress).not.toHaveBeenCalled();
});

test("cancel_opens_nothing", () => {
  const onClose = vi.fn();
  render(<LinkPrompt url="https://example.org/" onClose={onClose} />);
  // The focus is on Cancel, so a stray Enter opens nothing.
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(opener.openAddress).not.toHaveBeenCalled();
});

test("escape_opens_nothing", () => {
  const onClose = vi.fn();
  render(<LinkPrompt url="https://example.org/" onClose={onClose} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
  expect(opener.openAddress).not.toHaveBeenCalled();
});

test("open_hands_the_address_to_the_system_and_closes", async () => {
  const onClose = vi.fn();
  render(<LinkPrompt url="mailto:a@example.org" onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(opener.openAddress).toHaveBeenCalledWith("mailto:a@example.org");
});

test("a_link_the_system_cannot_open_says_why_and_stays", async () => {
  opener.openAddress.mockRejectedValue({
    kind: "Ipc",
    message: "no handler",
    path: null,
    details: null,
  });
  const onClose = vi.fn();
  render(<LinkPrompt url="tel:1" onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no handler");
  expect(onClose).not.toHaveBeenCalled();
});
