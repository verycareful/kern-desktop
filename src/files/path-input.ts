// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";

export type ParsedLocation = { ok: true; path: WirePath } | { ok: false; message: string };

const fail = (message: string): ParsedLocation => ({ ok: false, message });

/**
 * Turns what was typed in the location bar into an absolute path. `~` and
 * `~/...` mean `home`; `~user` is refused (the user database is not read).
 * "." and ".." are resolved in the text, as a shell's `cd` does by default,
 * and repeated or trailing slashes are dropped. The text is not trimmed. A relative path is refused
 * rather than guessed at, since the bar has no working directory of its own.
 */
export function parseLocation(text: string, home: WirePath | null): ParsedLocation {
  // Not trimmed: a folder's name may begin or end with a space.
  let t = text;
  if (t === "") return fail("Enter a path.");
  if (t.includes("\ufffd")) {
    return fail(
      "The name contains a character that is not valid UTF-8 and cannot be typed back. Use the breadcrumb or the parent folder to get there."
    );
  }
  if (t.includes("\0")) return fail("A path cannot contain a NUL character.");
  if (t === "~" || t.startsWith("~/")) {
    if (home === null) return fail("The Home folder is not known, so ~ cannot be expanded.");
    if (home.k !== "Utf8") {
      return fail("The Home folder's name is not valid UTF-8, so ~ cannot be expanded.");
    }
    t = home.v + t.slice(1);
  } else if (t.startsWith("~")) {
    return fail("Only ~ and ~/ are expanded; type the full path of another user's folder.");
  }
  if (!t.startsWith("/"))
    return fail("Enter an absolute path (starting with /) or one starting with ~.");
  const parts: string[] = [];
  for (const part of t.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return { ok: true, path: { k: "Utf8", v: "/" + parts.join("/") } };
}
