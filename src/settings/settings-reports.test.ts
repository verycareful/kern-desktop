// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import type { CorruptReport } from "../ipc";
import { useOps } from "../ops/useOps";
import { corruptText, useStoreErrors } from "../store/store-errors";
import { useSettingsReportNotice } from "./settings-reports";

const settingsReport: CorruptReport = {
  file: "settings.json",
  moved_to: null,
  field: "accent",
  reason: "unknown variant",
};

beforeEach(() => {
  useStoreErrors.getState().reset();
  useOps.setState({ notice: null });
});

test("an_unreadable_settings_file_is_said_in_the_main_window", () => {
  renderHook(() => useSettingsReportNotice());
  expect(useOps.getState().notice).toBeNull();
  act(() => useStoreErrors.setState({ reports: [settingsReport] }));
  expect(useOps.getState().notice?.text).toBe(corruptText(settingsReport));
});

test("a_report_already_there_is_said_and_other_files_are_not", () => {
  const pins: CorruptReport = { file: "pins.json", moved_to: null, field: null, reason: "eof" };
  useStoreErrors.setState({ reports: [settingsReport] });
  renderHook(() => useSettingsReportNotice());
  expect(useOps.getState().notice?.text).toBe(corruptText(settingsReport));
  useOps.setState({ notice: null });
  // pins.json is Pinned and Recent's to say; a report is said once.
  act(() => useStoreErrors.setState((s) => ({ reports: [...s.reports, pins] })));
  expect(useOps.getState().notice).toBeNull();
});

test("an_unreadable_binds_file_is_said_in_the_main_window_too", () => {
  const binds: CorruptReport = {
    file: "binds.json",
    moved_to: { k: "Utf8", v: "/c/kern/binds.json.corrupt-1" },
    field: null,
    reason: "not an object",
  };
  renderHook(() => useSettingsReportNotice());
  act(() => useStoreErrors.setState({ reports: [binds] }));
  expect(useOps.getState().notice?.text).toBe(corruptText(binds));
});
