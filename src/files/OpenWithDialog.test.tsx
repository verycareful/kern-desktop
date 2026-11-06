// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WireApp } from "../ipc";
import { entry } from "./test-entries";

const ipc = vi.hoisted(() => ({
  appsFor: vi.fn(),
  allApps: vi.fn(),
  launchApp: vi.fn(),
  setDefaultApp: vi.fn(),
  settingsGet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { OpenWithDialog } from "./OpenWithDialog";

const app = (id: string, name: string): WireApp => ({
  id,
  name,
  icon: null,
  terminal: false,
  no_display: false,
  mime_types: [],
});
const file = entry("notes.md", { mime: "text/markdown" });
const onClose = vi.fn();

beforeEach(() => {
  ipc.appsFor.mockResolvedValue({ apps: [app("gedit.desktop", "Text Editor")], problems: [] });
  ipc.allApps.mockResolvedValue({
    apps: [app("gedit.desktop", "Text Editor"), app("org.kde.kate.desktop", "Kate")],
    problems: [],
  });
  ipc.launchApp.mockResolvedValue(undefined);
  ipc.setDefaultApp.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue({ terminal: null } as Settings);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("open_with_sets_default", async () => {
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByLabelText("Always use it for text/markdown"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(ipc.setDefaultApp).toHaveBeenCalledExactlyOnceWith("gedit.desktop", "text/markdown");
  expect(ipc.launchApp).toHaveBeenCalledExactlyOnceWith("gedit.desktop", [file.path], undefined);
  expect(ipc.setDefaultApp.mock.invocationCallOrder[0]!).toBeLessThan(
    ipc.launchApp.mock.invocationCallOrder[0]!
  );
});

test("without_always_the_default_is_left_alone", async () => {
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(ipc.launchApp).toHaveBeenCalled());
  expect(ipc.setDefaultApp).not.toHaveBeenCalled();
});

test("other_application_lists_every_one_filtered_by_name", async () => {
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  await screen.findByLabelText("Text Editor");
  fireEvent.click(screen.getByRole("button", { name: "Other application…" }));
  await screen.findByLabelText("Kate");
  fireEvent.change(screen.getByLabelText("Filter applications"), { target: { value: "ka" } });
  expect(screen.queryByLabelText("Text Editor")).toBeNull();
  fireEvent.click(screen.getByLabelText("Kate"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() =>
    expect(ipc.launchApp).toHaveBeenCalledWith("org.kde.kate.desktop", [file.path], undefined)
  );
});

test("a_failed_default_stops_the_open_and_keeps_the_dialog", async () => {
  ipc.setDefaultApp.mockRejectedValue({
    kind: "XdgMime",
    message: "exit 1",
    path: null,
    details: null,
  });
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByLabelText("Always use it for text/markdown"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(
    await screen.findByText(
      "Text Editor could not be made the default for text/markdown, so the file was not opened: XdgMime: exit 1"
    )
  ).toBeTruthy();
  expect(ipc.launchApp).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("entries_that_could_not_be_read_are_listed", async () => {
  ipc.appsFor.mockResolvedValue({
    apps: [],
    problems: [{ kind: "Parse", message: "bad.desktop: no Exec", path: null, details: null }],
  });
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  expect(await screen.findByText("1 application entry could not be read")).toBeTruthy();
  expect(screen.getByText("Parse: bad.desktop: no Exec")).toBeTruthy();
  expect(screen.getByText(/No application says it opens text\/markdown/)).toBeTruthy();
});

test("an_application_filtered_away_is_not_the_one_that_opens", async () => {
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Other application…" }));
  await screen.findByLabelText("Kate");
  fireEvent.change(screen.getByLabelText("Filter applications"), { target: { value: "ka" } });
  expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(ipc.launchApp).not.toHaveBeenCalled();
});

test("no_default_is_offered_for_an_unknown_type", async () => {
  render(<OpenWithDialog entry={entry("blob")} onClose={onClose} />);
  expect(
    await screen.findByText("The type of blob is not known, so no default can be set for it.")
  ).toBeTruthy();
  expect(screen.queryByLabelText(/Always use it/)).toBeNull();
});

test("a_failed_open_after_the_default_changed_says_so", async () => {
  ipc.launchApp.mockRejectedValue({
    kind: "Launch",
    message: "exec failed",
    path: null,
    details: null,
  });
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByLabelText("Always use it for text/markdown"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(
    await screen.findByText(
      "Text Editor could not open notes.md: Launch: exec failed. Text Editor is now the default for text/markdown."
    )
  ).toBeTruthy();
});

test("an_unreadable_terminal_setting_leaves_the_default_alone", async () => {
  ipc.settingsGet.mockRejectedValue({ kind: "Io", message: "denied", path: null, details: null });
  render(<OpenWithDialog entry={file} onClose={onClose} />);
  fireEvent.click(await screen.findByLabelText("Text Editor"));
  fireEvent.click(screen.getByLabelText("Always use it for text/markdown"));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The terminal setting could not be read"
  );
  expect(ipc.setDefaultApp).not.toHaveBeenCalled();
});
