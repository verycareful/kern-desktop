// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";

// What a row or card shows to identify an entry: Kern's six document formats
// get their outlined badge in the format hue (design handoff README,
// "File-format identity"); every other file gets its extension as a monogram
// in the neutral colour; folders get the folder icon.

export type FileTypeId =
  "folder" | "pdf" | "word" | "ppt" | "excel" | "csv" | "epub" | "image" | "text" | "other";

export interface FileType {
  id: FileTypeId;
  /** The monogram: at most four upper-case characters. */
  mono: string;
  /** The name of the CSS custom property holding the format hue, or null for the neutral colour. */
  hue: string | null;
  /** The text of the Type column. */
  label: string;
}

/** True for a folder and for a link that resolves to one (a link to a folder opens as a folder). */
export function isFolder(e: Pick<WireEntry, "kind" | "target_is_dir">): boolean {
  return e.kind === "dir" || (e.kind === "symlink" && e.target_is_dir);
}

// Handoff README, "Color - File-format identity": monogram per format. Legacy
// .doc, .ppt and .xls get the same badge as their successors; the badge only
// names the family, and Kern's MIME list does not claim them (CLAUDE.md).
const FORMATS: Record<string, FileType> = {
  pdf: { id: "pdf", mono: "PDF", hue: "--kern-fmt-pdf", label: "PDF" },
  doc: { id: "word", mono: "DOC", hue: "--kern-fmt-doc", label: "Word" },
  ppt: { id: "ppt", mono: "PPT", hue: "--kern-fmt-ppt", label: "PowerPoint" },
  xls: { id: "excel", mono: "XLS", hue: "--kern-fmt-xls", label: "Excel" },
  csv: { id: "csv", mono: "CSV", hue: "--kern-fmt-csv", label: "CSV" },
  epub: { id: "epub", mono: "EPB", hue: "--kern-fmt-epb", label: "EPUB" },
};
const FAMILY: Record<string, string> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  ppt: "ppt",
  pptx: "ppt",
  xls: "xls",
  xlsx: "xls",
  csv: "csv",
  epub: "epub",
};

const FOLDER: FileType = { id: "folder", mono: "", hue: null, label: "Folder" };

/** The extension after the last dot, lower case; none for "x", ".x" and "x.". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileType(e: WireEntry): FileType {
  if (isFolder(e)) return FOLDER;
  const ext = extensionOf(e.name);
  const family = FAMILY[ext];
  if (family) return FORMATS[family]!;
  const mono = ext ? ext.slice(0, 4).toUpperCase() : "FILE";
  if (e.mime.startsWith("image/")) return { id: "image", mono, hue: null, label: mono };
  if (e.mime.startsWith("text/")) return { id: "text", mono, hue: null, label: mono };
  return { id: "other", mono, hue: null, label: mono };
}
