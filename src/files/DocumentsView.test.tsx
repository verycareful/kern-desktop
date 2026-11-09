// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WirePath } from "../ipc";
import { stubLayout } from "./test-layout";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  documents: vi.fn(),
  cancelOp: vi.fn(),
  settingsSet: vi.fn(),
  userDirs: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { currentContext, getAction, runAction } from "../keys/actions";
import { useUserDirs } from "../shell/user-dirs-store";
import { DocumentsView } from "./DocumentsView";
import { useViewSettings } from "./view-settings";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const DOCS = p("/home/t/Documents");
const DOWN = p("/home/t/Downloads");
let restoreLayout: () => void;
let stored: Partial<Settings>;
let nextOp: number;

function settings(over: Partial<Settings>) {
  stored = { scan_documents: true, scan_downloads: true, scan_roots: [], ...over };
  useViewSettings.setState({
    loaded: true,
    error: null,
    scanDocuments: stored.scan_documents!,
    scanDownloads: stored.scan_downloads!,
    scanRoots: stored.scan_roots!,
  });
}

beforeEach(() => {
  restoreLayout = stubLayout();
  nextOp = 1;
  ipc.on.mockResolvedValue(() => undefined);
  ipc.documents.mockImplementation(() => Promise.resolve(nextOp++));
  ipc.cancelOp.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({
    home: p("/home/t"),
    dirs: [
      { name: "documents", path: DOCS },
      { name: "download", path: DOWN },
    ],
  });
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) => {
    stored = { ...stored, ...patch };
    return Promise.resolve({
      show_hidden: false,
      view_mode: "list",
      interface_size: 90,
      ...stored,
    } as Settings);
  });
  useUserDirs.getState().reset();
});
afterEach(() => {
  cleanup();
  restoreLayout();
  vi.clearAllMocks();
});

test("documents_respects_toggles", async () => {
  settings({ scan_documents: true, scan_downloads: false });
  render(<DocumentsView tabId="t" />);
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenCalledWith(expect.any(String), [DOCS], false)
  );
  expect(screen.getByTestId("documents-roots")).toHaveTextContent("Looking in ~/Documents");
  fireEvent.click(screen.getByLabelText("Downloads"));
  expect(ipc.settingsSet).toHaveBeenCalledWith({ scan_downloads: true });
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenLastCalledWith(expect.any(String), [DOCS, DOWN], false)
  );
  // The walk before is stopped.
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(1));
  fireEvent.click(screen.getByLabelText("Documents"));
  expect(ipc.settingsSet).toHaveBeenLastCalledWith({ scan_documents: false });
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenLastCalledWith(expect.any(String), [DOWN], false)
  );
});

test("the_view_is_called_the_library", async () => {
  settings({ scan_documents: true, scan_downloads: false });
  render(<DocumentsView tabId="t" />);
  expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
  expect(getAction("place.documents").label).toBe("Open Library");
});

test("the_settings_folders_are_walked_too_once_each", async () => {
  settings({ scan_downloads: false, scan_roots: [p("/srv/papers"), DOCS] });
  render(<DocumentsView tabId="t" />);
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenCalledWith(expect.any(String), [DOCS, p("/srv/papers")], false)
  );
});

test("with_nowhere_to_look_nothing_is_walked_and_it_says_so", async () => {
  settings({ scan_documents: false, scan_downloads: false });
  render(<DocumentsView tabId="t" />);
  expect(await screen.findByText(/There is nowhere to look/)).toBeTruthy();
  expect(ipc.documents).not.toHaveBeenCalled();
});

test("a_folder_that_does_not_exist_is_said", async () => {
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [{ name: "download", path: DOWN }] });
  settings({});
  render(<DocumentsView tabId="t" />);
  expect(await screen.findByText(/There is no Documents folder to look in/)).toBeTruthy();
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenCalledWith(expect.any(String), [DOWN], false)
  );
});

test("f5_walks_again", async () => {
  settings({ scan_downloads: false });
  render(<DocumentsView tabId="t" />);
  await waitFor(() => expect(ipc.documents).toHaveBeenCalledTimes(1));
  expect(getAction("documents.refresh").keys).toContain("F5");
  runAction(getAction("documents.refresh"), {
    ...currentContext(),
    target: { id: "x", kind: "documents" },
  });
  await waitFor(() => expect(ipc.documents).toHaveBeenCalledTimes(2));
});
