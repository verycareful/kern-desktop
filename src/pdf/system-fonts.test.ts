// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ pdfSetSystemFonts: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

const wireError = (kind: string, message = kind) => ({ kind, message, path: null, details: null });

// The module remembers that it asked, so each test loads it afresh.
async function load() {
  vi.resetModules();
  const { ensureSystemFonts } = await import("./system-fonts");
  const { useOps } = await import("../ops/useOps");
  useOps.setState({ notice: null });
  return { ensureSystemFonts, useOps };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfSetSystemFonts.mockResolvedValue({ faces: 12, skipped: 0, unreadable_dirs: 0 });
});

test("the_fonts_are_indexed_once_however_many_documents_ask", async () => {
  const { ensureSystemFonts, useOps } = await load();
  await Promise.all([ensureSystemFonts(), ensureSystemFonts()]);
  await ensureSystemFonts();
  expect(ipc.pdfSetSystemFonts).toHaveBeenCalledTimes(1);
  expect(useOps.getState().notice).toBeNull();
});

test("a_failure_is_said_and_the_next_document_tries_again", async () => {
  ipc.pdfSetSystemFonts.mockRejectedValueOnce(wireError("Io", "cannot read the font folders"));
  const { ensureSystemFonts, useOps } = await load();
  await ensureSystemFonts();
  expect(useOps.getState().notice).not.toBeNull();
  await ensureSystemFonts();
  expect(ipc.pdfSetSystemFonts).toHaveBeenCalledTimes(2);
  await ensureSystemFonts();
  expect(ipc.pdfSetSystemFonts).toHaveBeenCalledTimes(2);
});

test("folders_that_could_not_be_read_are_said", async () => {
  ipc.pdfSetSystemFonts.mockResolvedValue({ faces: 3, skipped: 0, unreadable_dirs: 2 });
  const { ensureSystemFonts, useOps } = await load();
  await ensureSystemFonts();
  expect(JSON.stringify(useOps.getState().notice)).toContain("2 font folders could not be read");
});
