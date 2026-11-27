// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfSave: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { entryAtStamp, needsCompactedCopy, runSave, saveFailure } from "./pdf-save";

const FILE: WirePath = { k: "Utf8", v: "/home/a/book.pdf" };
const wireError = (kind: string): WireError => ({ kind, message: kind, path: null, details: null });

beforeEach(() => vi.clearAllMocks());

test("a_save_sends_the_pdf_date_of_the_clock_it_was_given", async () => {
  ipc.pdfSave.mockResolvedValue("s2");
  const r = await runSave(
    3,
    FILE,
    { kind: "unchanged", stamp: "s1" },
    new Date(Date.UTC(2026, 10, 26, 9, 5, 7))
  );
  expect(r).toEqual({ ok: true, stamp: "s2" });
  const date = ipc.pdfSave.mock.calls[0]![3] as string;
  expect(date).toMatch(/^D:20261126\d{4}\d{2}[+-]\d\d'\d\d'$/);
});

test.each([
  ["ExternalModification", "external-modification"],
  ["Exists", "exists"],
  ["Io", "other"],
  ["Cancelled", "other"],
] as const)("the_refusal_%s_is_told_as_%s", async (kind, told) => {
  ipc.pdfSave.mockRejectedValue(wireError(kind));
  const r = await runSave(3, FILE, { kind: "nothing" });
  expect(r).toMatchObject({ ok: false, kind: told, error: { kind } });
  expect(saveFailure(wireError(kind))).toBe(told);
});

test("a_save_never_rejects", async () => {
  ipc.pdfSave.mockRejectedValue("a plain string");
  await expect(runSave(3, FILE, { kind: "anything" })).resolves.toMatchObject({ ok: false });
});

test("only_a_rebuilt_or_an_earlier_revision_refusal_offers_a_compacted_copy", () => {
  expect(needsCompactedCopy(wireError("RebuiltNotEditable"))).toBe(true);
  expect(needsCompactedCopy(wireError("RevisionNotEditable"))).toBe(true);
  expect(needsCompactedCopy(wireError("WrongPassword"))).toBe(false);
  expect(needsCompactedCopy(undefined)).toBe(false);
});

test("the_entry_of_a_file_is_taken_only_while_its_stamp_says_it_is_the_one_opened", async () => {
  ipc.textCheck.mockResolvedValue("same");
  ipc.entryOf.mockResolvedValue({ len: 3 });
  await expect(entryAtStamp(FILE, "s1")).resolves.toEqual({ len: 3 });
  ipc.textCheck.mockResolvedValueOnce("same").mockResolvedValueOnce("changed");
  await expect(entryAtStamp(FILE, "s1")).resolves.toBeNull();
  ipc.textCheck.mockResolvedValue("deleted");
  await expect(entryAtStamp(FILE, "s1")).resolves.toBeNull();
  ipc.textCheck.mockRejectedValue(wireError("Io"));
  await expect(entryAtStamp(FILE, "s1")).resolves.toBeNull();
});
