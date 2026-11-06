// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  isEditorWindow: vi.fn(),
  recentTouch: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { recordEditorFolder } from "./editor-recent";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useLayout.getState().reset();
  ipc.recentTouch.mockResolvedValue({ entries: [] });
});
afterEach(() => vi.clearAllMocks());

test("an_editor_window_records_its_folder_as_an_editor", async () => {
  ipc.isEditorWindow.mockReturnValue(true);
  useLayout.getState().setTreeRoot(p("/home/t/Work"));
  await recordEditorFolder();
  expect(ipc.recentTouch).toHaveBeenCalledExactlyOnceWith(p("/home/t/Work"), true);
});

test("the_main_window_and_a_window_with_no_folder_yet_record_nothing", async () => {
  ipc.isEditorWindow.mockReturnValue(false);
  useLayout.getState().setTreeRoot(p("/home/t/Work"));
  await recordEditorFolder();
  ipc.isEditorWindow.mockReturnValue(true);
  useLayout.getState().setTreeRoot(null);
  await recordEditorFolder();
  expect(ipc.recentTouch).not.toHaveBeenCalled();
});

test("a_failed_record_is_said", async () => {
  ipc.isEditorWindow.mockReturnValue(true);
  useLayout.getState().setTreeRoot(p("/home/t/Work"));
  ipc.recentTouch.mockRejectedValue({
    kind: "Io",
    message: "disk full",
    path: null,
    details: null,
  });
  const notify = vi.spyOn(useOps.getState(), "notify");
  await recordEditorFolder();
  expect(notify).toHaveBeenCalledWith(
    expect.stringMatching(/^Work could not be added to Recent: .*disk full/)
  );
});
