// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";

// What a typed file name must be (POSIX.1-2017, Base Definitions 3.170,
// "Filename": its bytes are neither NUL nor slash; "." and ".." name the
// directory itself and its parent, so no entry can be called by them). The
// name is text typed by the user, so it always travels as a UTF-8 string; the
// backend checks it again and its refusals are shown as they come.

/** Why `name` cannot be a file name, or null when it can. The name is not trimmed: a leading or trailing space is part of it. */
export function nameProblem(name: string): string | null {
  if (name === "") return "Enter a name; it cannot be empty.";
  if (name.includes("/")) return 'A name cannot contain "/".';
  if (name.includes("\0")) return "A name cannot contain a NUL character.";
  if (name === ".") return 'A name cannot be ".".';
  if (name === "..") return 'A name cannot be "..".';
  return null;
}

/**
 * False when the last component of `path` is not valid UTF-8: its name is
 * shown with U+FFFD for the bytes that are not text, and typing it back would
 * produce a different file name. A path that is not valid UTF-8 only in a
 * folder above the item has a name that is text.
 */
export function nameIsText(path: WirePath): boolean {
  if (path.k === "Utf8") return true;
  let bin: string;
  try {
    bin = atob(path.v);
  } catch {
    return false;
  }
  const trimmed = bin.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(last, (c) => c.charCodeAt(0)));
    return true;
  } catch {
    return false;
  }
}
