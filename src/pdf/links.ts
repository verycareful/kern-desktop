// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfLink } from "../ipc/pdf";

// What a link of a page leads to. A page link goes to a page of this document; web, mail and
// phone addresses are handed to the system after the user has seen them; every other link (a file
// on disk, another document, a script, an address with no scheme Kern opens) is not followed.

/** The schemes of an address that is handed to the system. */
const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);

// Characters no address holds: a URL parser drops some of them silently, so an address with one
// would open as something other than what was read.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\s]/u;

export type LinkTarget =
  | { kind: "page"; /** Counted from 0. */ page: number }
  | { kind: "external"; /** The address as it is shown and as it is opened. */ url: string }
  | { kind: "unsupported" };

/** Where `link` leads. A link that names a page leads there, whatever else it carries. */
export function classifyLink(link: PdfLink): LinkTarget {
  if (typeof link.page === "number" && Number.isInteger(link.page) && link.page >= 0) {
    return { kind: "page", page: link.page };
  }
  const uri = link.uri;
  if (uri === undefined || uri === "" || CONTROL.test(uri)) return { kind: "unsupported" };
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { kind: "unsupported" };
  }
  if (!EXTERNAL_SCHEMES.has(url.protocol)) return { kind: "unsupported" };
  // An address with a host has one; mail and phone addresses have none.
  if (url.protocol.startsWith("http") && url.hostname === "") return { kind: "unsupported" };
  return { kind: "external", url: url.href };
}

/** The first link of `links` that has a box holding the point (fractions of the page). */
export function linkAt(links: readonly PdfLink[], x: number, y: number): PdfLink | undefined {
  return links.find((l) => l.rects.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3]));
}
