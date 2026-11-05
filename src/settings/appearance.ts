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

/** Each accent's colour (kernkraft-theme kern_tokens.rs, `KernAccent::rgba`), for its swatch. */
export const ACCENT_COLOURS: Readonly<Record<KernAccent, string>> = {
  slate: "#3f5b8b",
  indigo: "#4f46e5",
  violet: "#7c6cf4",
  plum: "#9b4dca",
  ocean: "#0e7490",
  teal: "#1e8c84",
  forest: "#2f7a52",
  amber: "#c9881f",
  copper: "#b5651d",
  crimson: "#be3455",
  rose: "#c24a6b",
  graphite: "#52525b",
};

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
