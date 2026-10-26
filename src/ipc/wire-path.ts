// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// A path as it crosses the IPC boundary. Mirrors kernkraft-tauri's WirePath
// (src/wire.rs): serde tag "k", content "v". A path that is valid UTF-8
// travels as Utf8; any other travels as Bytes, the standard padded base64
// (RFC 4648 section 4) of its raw bytes. The backend has a third, Invalid
// form for values it received and could not parse; it never sends it, so it
// is not a type here.
export type WirePath = { k: "Utf8"; v: string } | { k: "Bytes"; v: string };

// A stable map key. The tag is part of it: a Bytes payload is never the same
// path as a Utf8 string that happens to spell the same characters.
export function pathKey(p: WirePath): string {
  return `${p.k}:${p.v}`;
}

// The path for display. Bytes that are not UTF-8 show as U+FFFD, and a Bytes
// payload that is not valid base64 shows as its text, as the backend's
// WirePath::display does. Never turn the result back into a path.
export function displayPath(p: WirePath): string {
  if (p.k === "Utf8") return p.v;
  try {
    const bin = atob(p.v);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return p.v;
  }
}

// The child `name` of a Utf8 parent. A Bytes parent cannot be joined here
// without decoding the bytes into text, which would change the path, so it
// goes through the backend (the commands that take a parent and a name).
// `name` is one path component: no separator, no NUL, not empty.
export function join(parent: WirePath, name: string): WirePath {
  if (parent.k !== "Utf8") {
    throw new TypeError("cannot join onto a Bytes path; use a command that takes parent and name");
  }
  if (name === "" || name.includes("/") || name.includes("\0")) {
    throw new RangeError(`not a single path component: ${JSON.stringify(name)}`);
  }
  const base = parent.v.endsWith("/") ? parent.v : `${parent.v}/`;
  return { k: "Utf8", v: `${base}${name}` };
}
