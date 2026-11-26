// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// A PDF in the document window of the real app: a change is made, asked about before the first
// edit, saved into the file, and kept after the window closes; a file another program changed is
// never written over. A command the capability does not grant is refused by Tauri, so a missing
// grant shows here as a window that cannot do what it is for.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";
import {
  SHOWS_WITHIN_MS,
  clickClosingWindow,
  focusWindow,
  freshAppPerTest,
  kern,
  only,
  sleep,
  waitForWindows,
} from "./support/app";
import { PAGE_TEXT, onePagePdf, textPagePdf } from "./support/pdf";
import { testDir } from "./support/world";

/**
 * How long a window gets to show a PDF's pages. The first PDF a window opens indexes the fonts of
 * the system before it opens, and the debug build the suite runs does that slowly: it took close to
 * half a minute on a development machine with many fonts installed.
 */
const PDF_SHOWS_WITHIN_MS = 80_000;

/** Waits until the window in front shows the pages of a PDF, or says what it showed instead. */
async function waitForPages(): Promise<void> {
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
async function openPdf(file: string): Promise<void> {
  expect(kern([file]).status).toBe(0);
  const ws = await waitForWindows((w) => w.some((x) => x.kind === "doc"), "a document window");
  await focusWindow(only(ws, "doc").handle);
  await waitForPages();
}

/** Asks to rotate the page in view, and says no to a copy, which the first edit asks about. */
async function rotateWithoutACopy(): Promise<void> {
  await browser.keys(["Control", "r"]);
  const without = await browser.$("button=Edit without a copy");
  await without.waitForClickable({ timeout: SHOWS_WITHIN_MS });
  await without.click();
}

describe("pdf", function () {
  // Two openings of a PDF, each slow in the debug build, and the typing between them.
  this.timeout(240_000);
  freshAppPerTest();

  it("edit_save_and_reopen", async () => {
    const dir = testDir("pdf-save");
    const file = path.join(dir, "book.pdf");
    const original = onePagePdf();
    writeFileSync(file, original);
    await openPdf(file);

    await rotateWithoutACopy();
    // The change reaches the engine a moment after the click, and there is nothing to save before
    // it does, so Ctrl+S is pressed again until the file has it; a press with nothing to save does
    // nothing.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "s"]);
        return readFileSync(file).length > original.length;
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: "the rotated PDF was not saved by the document window",
      }
    );
    const saved = readFileSync(file);
    // The opened bytes are kept as they were and the change is one update after them.
    expect(saved.subarray(0, original.length).equals(original)).toBe(true);
    expect(saved.toString("latin1")).toContain("/Rotate 90");

    // Saved, so closing the window asks nothing and the rotation is in the file.
    await clickClosingWindow('button[aria-label^="Home"]');
    await waitForWindows(
      (w) => w.length === 1 && w.some((x) => x.kind === "main"),
      "the main window alone"
    );
    expect(readFileSync(file).equals(saved)).toBe(true);

    // The main window now holds the document, saved and so clean. It opened the file afresh (a
    // PDF has no state to hand over), so what it shows is the file as saved.
    const main = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "book.pdf")),
      "the main window holding the PDF as a tab"
    );
    await focusWindow(only(main, "main").handle);
    await waitForPages();
    const banner = await browser.$('[data-testid="pdf-changed-banner"]');
    expect(await banner.isExisting()).toBe(false);
    expect(readFileSync(file).equals(saved)).toBe(true);
  });

  it("changed_on_disk_is_not_overwritten", async () => {
    const dir = testDir("pdf-changed");
    const file = path.join(dir, "book.pdf");
    writeFileSync(file, onePagePdf());
    await openPdf(file);
    await rotateWithoutACopy();

    // Another program writes the file while it is open here.
    const theirs = Buffer.concat([onePagePdf(), Buffer.from("% another program wrote this\n")]);
    writeFileSync(file, theirs);
    const banner = await browser.$('[data-testid="pdf-changed-banner"]');
    await banner.waitForExist({ timeout: SHOWS_WITHIN_MS });

    // Saving asks, and writes nothing until the user says to replace the file.
    await browser.keys(["Control", "s"]);
    const question = await browser.$('[data-testid="external-prompt"]');
    await question.waitForExist({ timeout: SHOWS_WITHIN_MS });
    await sleep(500);
    expect(readFileSync(file).equals(theirs)).toBe(true);
  });

  it("select_all_and_copy_a_pages_text", async () => {
    const dir = testDir("pdf-select");
    const file = path.join(dir, "words.pdf");
    writeFileSync(file, textPagePdf());
    await openPdf(file);

    // The text of the page is read once the page is near the view; Select all waits for it.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "a"]);
        return (await browser.$('[data-testid="pdf-selection"]')).isExisting();
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: `Select all did not select the text ${PAGE_TEXT}`,
      }
    );
    // Copy goes to the clipboard through a command the document window must be granted; the
    // window says so when it did, and says why when it did not.
    const copy = await browser.$("button=Copy");
    await copy.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await copy.click();
    const notice = async () => {
      const el = await browser.$('[data-testid="status-notice"]');
      return (await el.isExisting()) ? await el.getText() : "";
    };
    let said = "";
    await browser.waitUntil(
      async () => {
        said = await notice();
        return said !== "";
      },
      { timeout: SHOWS_WITHIN_MS, timeoutMsg: "Copy said nothing" }
    );
    expect(said).toBe("Copied the selected text");
  });
});
