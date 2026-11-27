// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// Opening a PDF in a document window of the real app, shared by the PDF specs.

import { expect } from "@wdio/globals";
import { focusWindow, kern, only, waitForWindows } from "./app";

/**
 * How long a window gets to show a PDF's pages. The first PDF a window opens indexes the fonts of
 * the system before it opens, and the debug build the suite runs does that slowly: it took close to
 * half a minute on a development machine with many fonts installed.
 */
export const PDF_SHOWS_WITHIN_MS = 80_000;

/** Waits until the window in front shows the pages of a PDF, or says what it showed instead. */
export async function waitForPages(): Promise<void> {
  try {
    await browser.waitUntil(
      async () => (await browser.$('[data-testid="pdf-pages"]')).isExisting(),
      { timeout: PDF_SHOWS_WITHIN_MS }
    );
  } catch {
    // What the window said is the evidence of what went wrong.
    const said = await browser.execute("return document.body.innerText");
    throw new Error(`the PDF did not show its pages; the window said: ${String(said)}`);
  }
}

/** Opens `file` from outside and waits for its document window to show a page. */
export async function openPdf(file: string): Promise<void> {
  expect(kern([file]).status).toBe(0);
  const ws = await waitForWindows((w) => w.some((x) => x.kind === "doc"), "a document window");
  await focusWindow(only(ws, "doc").handle);
  await waitForPages();
}
