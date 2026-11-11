// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// jsdom does not apply the stylesheet or draw text, so the rule is read from its text.
const css = readFileSync(resolve(process.cwd(), "src/theme/base.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

test("all_text_is_greyscale_antialiased_from_the_root_in_every_scheme", () => {
  const rule = /(?:^|\})\s*html\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toMatch(/-webkit-font-smoothing:\s*antialiased/);
  // The rule sits outside any media query, so the light and the dark scheme both get it.
  const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "");
  expect(outsideMedia).toMatch(/html\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/);
});
