// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTabs } from "../store/tabs";

// The window's own banner for a Home that could not be done. The editor, the status bar, the close
// prompt and the settings sync are other components' business and are stood in for.
const moveDocHome = vi.hoisted(() => vi.fn());
vi.mock("./move-doc", () => ({ moveDocHome }));
vi.mock("../editor/TextEditor", () => ({ TextEditor: () => <div data-testid="editor" /> }));
vi.mock("./StatusBar", () => ({ StatusBar: () => null }));
vi.mock("./ClosePrompt", () => ({ ClosePrompt: () => null }));
vi.mock("../files/view-settings", () => ({ useViewSettingsSync: () => undefined }));
vi.mock("../keys/useShortcuts", () => ({ useShortcuts: () => undefined }));

import { DocumentWindow } from "./DocumentWindow";

beforeEach(() => {
  useTabs.setState({
    tabs: [{ id: "doc-1", kind: "doc", path: { k: "Utf8", v: "/d/a.md" }, dirty: false }],
    activeId: "doc-1",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useTabs.setState({ tabs: [], activeId: null });
});

const home = () => screen.getByRole("button", { name: /^Home:/ });
const banner = () => screen.getByTestId("home-error");

test("a_home_that_fails_again_with_the_same_words_flashes_the_banner", async () => {
  moveDocHome.mockResolvedValue("The document was not moved: it has a question open.");
  render(<DocumentWindow label="doc-1" starting={false} />);
  fireEvent.click(home());
  await screen.findByTestId("home-error");
  expect(banner()).toHaveTextContent("it has a question open");
  expect(banner().querySelector(".kern-repeat-flash")).toBeNull();
  await waitFor(() => expect(home()).toBeEnabled());
  fireEvent.click(home());
  await waitFor(() => expect(banner().querySelector(".kern-repeat-flash")).not.toBeNull());
  expect(moveDocHome).toHaveBeenCalledTimes(2);
});

test("a_home_that_fails_for_another_reason_shows_the_new_words_without_a_flash", async () => {
  moveDocHome.mockResolvedValueOnce("The document was not moved: it has a question open.");
  moveDocHome.mockResolvedValueOnce("The document was not moved: the main window is gone.");
  render(<DocumentWindow label="doc-1" starting={false} />);
  fireEvent.click(home());
  await screen.findByText(/question open/);
  await waitFor(() => expect(home()).toBeEnabled());
  fireEvent.click(home());
  await screen.findByText(/main window is gone/);
  expect(banner().querySelector(".kern-repeat-flash")).toBeNull();
});
