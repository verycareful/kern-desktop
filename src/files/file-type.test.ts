// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fileType } from "./file-type";
import { dir, entry } from "./test-entries";

test("folders_and_links_to_folders", () => {
  expect(fileType(dir("x")).id).toBe("folder");
  expect(fileType(entry("l", { kind: "symlink", target_is_dir: true })).id).toBe("folder");
});

test("the_six_document_formats_have_their_monogram", () => {
  const mono = (n: string) => fileType(entry(n)).mono;
  expect(mono("a.pdf")).toBe("PDF");
  expect(mono("a.DOCX")).toBe("DOC");
  expect(mono("a.pptx")).toBe("PPT");
  expect(mono("a.xlsx")).toBe("XLS");
  expect(mono("a.csv")).toBe("CSV");
  expect(mono("a.epub")).toBe("EPB");
  for (const n of ["a.pdf", "a.docx", "a.pptx", "a.xlsx", "a.csv", "a.epub"]) {
    expect(fileType(entry(n)).hue, n).toMatch(/^--kern-fmt-/);
  }
});

test("other_files_get_their_extension_or_their_mime_class", () => {
  expect(fileType(entry("photo.png", { mime: "image/png" }))).toMatchObject({
    id: "image",
    mono: "PNG",
    hue: null,
  });
  expect(fileType(entry("notes.md", { mime: "text/markdown" }))).toMatchObject({
    id: "text",
    mono: "MD",
  });
  expect(fileType(entry("Makefile", { mime: "text/x-makefile" })).id).toBe("text");
  expect(fileType(entry("blob.bin"))).toMatchObject({ id: "other", mono: "BIN" });
  // No extension and no known class: a generic monogram.
  expect(fileType(entry("core")).mono).toBe("FILE");
  // Long extensions are cut to four characters.
  expect(fileType(entry("a.torrentfile")).mono).toBe("TORR");
  // A dotfile has no extension.
  expect(fileType(entry(".bashrc")).mono).toBe("FILE");
});
