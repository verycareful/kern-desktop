// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { whereOpen } from "./open-elsewhere";

test("where_a_document_is_open_is_said_from_the_asking_window", () => {
  const tab = (window: string) => ({ kind: "tab", window, tab_id: "t" }) as const;
  expect(whereOpen(tab("main"), "main")).toBe("in another tab of this window");
  expect(whereOpen(tab("editor-2"), "editor-2")).toBe("in another tab of this window");
  expect(whereOpen(tab("main"), "editor-1")).toBe("in a tab of the main window");
  expect(whereOpen(tab("editor-1"), "main")).toBe("in a tab of an editor window");
  expect(whereOpen({ kind: "window", label: "doc-3" }, "main")).toBe("in a window of its own");
});
