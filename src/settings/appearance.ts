// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { KernAccent } from "../ipc";

/** Kern's accents (kernkraft-theme), in the order of the design handoff. */
export const ACCENTS: readonly KernAccent[] = [
  "slate",
  "indigo",
  "violet",
  "plum",
  "ocean",
  "teal",
  "forest",
  "amber",
  "copper",
  "crimson",
  "rose",
  "graphite",
];

/** What a token that fell back is, in words (kernkraft-theme resolve.rs names them). */
const TOKEN_WORDS: Record<string, string> = {
  bg: "background colour",
  surface: "surface colour",
  sunken: "sunken background colour",
  text: "text colour",
};

/** The note for a token that fell back to Kern's own for failing WCAG AA contrast. */
export function fallbackNote(token: string): string {
  const what = TOKEN_WORDS[token] ?? `${token} colour`;
  return token === "text"
    ? `Your system's ${what} fails WCAG AA contrast on its background; Kern uses its own here.`
    : `Your system's ${what} fails WCAG AA contrast with its text; Kern uses its own here.`;
}
