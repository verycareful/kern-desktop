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
  only,
  sleep,
  waitForWindows,
} from "./support/app";
import {
  LINK_ADDRESS,
  PAGE_TEXT,
  linkPagePdf,
  onePagePdf,
  pagesPdf,
  textPagePdf,
} from "./support/pdf";
import { openPdf, waitForPages } from "./support/pdf-window";
import { testDir } from "./support/world";

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

  it("highlight_the_selected_text_and_save_it", async () => {
    const dir = testDir("pdf-highlight");
    const file = path.join(dir, "words.pdf");
    const original = textPagePdf();
    writeFileSync(file, original);
    await openPdf(file);

    // Select all waits for the page's text, as in the test above; the menu of the selection then
    // offers the markup.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "a"]);
        return (await browser.$('[data-testid="pdf-selection"]')).isExisting();
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: `Select all did not select ${PAGE_TEXT}`,
      }
    );
    const highlight = await browser.$("button=Highlight");
    await highlight.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await highlight.click();
    // The first change asks about a copy; the annotation is made once it is answered.
    const without = await browser.$("button=Edit without a copy");
    await without.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await without.click();

    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "s"]);
        return readFileSync(file).length > original.length;
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: "the highlighted PDF was not saved by the document window",
      }
    );
    const saved = readFileSync(file);
    // The opened bytes are kept and the highlight is an update after them.
    expect(saved.subarray(0, original.length).equals(original)).toBe(true);
    expect(saved.subarray(original.length).toString("latin1")).toContain("/Highlight");
  });

  it("edit_the_text_of_a_block_and_save_it", async () => {
    // The driver drops repeated letters it types, so the new text has none.
    const NEW_TEXT = "Pencil";
    const dir = testDir("pdf-edit-text");
    const file = path.join(dir, "words.pdf");
    const original = textPagePdf();
    writeFileSync(file, original);
    await openPdf(file);

    const tool = await browser.$('button[aria-label="Edit text"]');
    await tool.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await tool.click();
    // The block is offered once the page's text has been read.
    const block = await browser.$(`button[aria-label="Edit text: ${PAGE_TEXT}"]`);
    await block.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await block.click();
    const box = await browser.$('textarea[aria-label="Text of the block"]');
    await box.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
    expect(await box.getValue()).toBe(PAGE_TEXT);
    await browser.keys(["Control", "a"]);
    await browser.keys(NEW_TEXT);
    await browser.keys("Enter");
    // The first change asks about a copy; the text is changed once it is answered.
    const without = await browser.$("button=Edit without a copy");
    await without.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await without.click();

    // The page's text is read again from the changed document: the engine has set the new text.
    // A change the engine refuses keeps the box open and says why in it, which is what to report.
    const shown = () =>
      browser.execute(() => ({
        blocks: Array.from(document.querySelectorAll(".kern-pdf-block")).map((b) =>
          b.getAttribute("aria-label")
        ),
        box: document.querySelector(".kern-pdf-block-box")?.textContent ?? null,
        alerts: Array.from(document.querySelectorAll("[role=alert], [role=status]")).map(
          (a) => a.textContent
        ),
      }));
    try {
      await browser.waitUntil(
        async () => {
          const said = await browser.$(".kern-pdf-block-box [role=alert]");
          if (await said.isExisting()) {
            throw new Error(`the box was refused: ${await said.getText()}`);
          }
          return browser.$(`button[aria-label="Edit text: ${NEW_TEXT}"]`).isExisting();
        },
        { timeout: SHOWS_WITHIN_MS, interval: 500 }
      );
    } catch (e) {
      throw new Error(`${String(e)}; the page shows ${JSON.stringify(await shown())}`);
    }

    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "s"]);
        return readFileSync(file).length > original.length;
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: "the PDF with the edited text was not saved by the document window",
      }
    );
    expect(readFileSync(file).equals(original)).toBe(false);
  });

  it("add_text_where_the_page_has_none_and_save_it", async () => {
    // The driver drops repeated letters it types, so the new text has none.
    const NEW_TEXT = "Lamp";
    const dir = testDir("pdf-add-text");
    const file = path.join(dir, "words.pdf");
    const original = textPagePdf();
    writeFileSync(file, original);
    await openPdf(file);

    const tool = await browser.$('button[aria-label="Edit text"]');
    await tool.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await tool.click();
    // The page takes a click once its text has been read; the block is offered at the same time.
    await (
      await browser.$(`button[aria-label="Edit text: ${PAGE_TEXT}"]`)
    ).waitForClickable({
      timeout: SHOWS_WITHIN_MS,
    });
    const surface = await browser.$('[data-testid="pdf-new-text-surface-0"]');
    const { width, height } = await surface.getSize();
    // Near the left edge and a fifth of the page above its middle, where the page has no text. With
    // the tools along the top the page is wider and so taller than the window, and its upper half is
    // what is in view; a point below the view is out of the driver's reach.
    await surface.click({ x: -Math.round(width * 0.4), y: -Math.round(height * 0.2) });
    const box = await browser.$('textarea[aria-label="New text"]');
    await box.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
    await browser.keys(NEW_TEXT);
    await browser.keys("Enter");
    const without = await browser.$("button=Edit without a copy");
    await without.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await without.click();

    // The page's text is read again from the changed document: the new text is a block of it.
    const shown = () =>
      browser.execute(() => ({
        blocks: Array.from(document.querySelectorAll(".kern-pdf-block")).map((b) =>
          b.getAttribute("aria-label")
        ),
        box: document.querySelector(".kern-pdf-new-text-box")?.textContent ?? null,
        alerts: Array.from(document.querySelectorAll("[role=alert], [role=status]")).map(
          (a) => a.textContent
        ),
      }));
    try {
      await browser.waitUntil(
        async () => {
          const said = await browser.$(".kern-pdf-new-text-box [role=alert]");
          if (await said.isExisting()) {
            throw new Error(`the box was refused: ${await said.getText()}`);
          }
          return browser.$(`button[aria-label="Edit text: ${NEW_TEXT}"]`).isExisting();
        },
        { timeout: SHOWS_WITHIN_MS, interval: 500 }
      );
    } catch (e) {
      throw new Error(`${String(e)}; the page shows ${JSON.stringify(await shown())}`);
    }
    // The page's own text is still there beside it.
    expect(await browser.$(`button[aria-label="Edit text: ${PAGE_TEXT}"]`).isExisting()).toBe(true);

    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "s"]);
        return readFileSync(file).length > original.length;
      },
      {
        timeout: SHOWS_WITHIN_MS,
        interval: 500,
        timeoutMsg: "the PDF with the new text was not saved by the document window",
      }
    );
    expect(readFileSync(file).equals(original)).toBe(false);
  });

  it("find_counts_a_word_and_steps_and_closes", async () => {
    const dir = testDir("pdf-find");
    const file = path.join(dir, "words.pdf");
    writeFileSync(file, textPagePdf());
    await openPdf(file);

    // Ctrl+F opens the bar once the document is shown; the question is searched as it is typed.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "f"]);
        return (await browser.$('[data-testid="pdf-find"]')).isExisting();
      },
      { timeout: SHOWS_WITHIN_MS, interval: 500, timeoutMsg: "Ctrl+F did not open the find bar" }
    );
    const field = await browser.$('[data-testid="pdf-find"] input');
    await field.setValue("kern");
    const count = await browser.$('[data-testid="pdf-find-count"]');
    await browser.waitUntil(async () => (await count.getText()) === "1 of 1", {
      timeout: SHOWS_WITHIN_MS,
      timeoutMsg: `the count said ${await count.getText()}, not 1 of 1 (the text is ${PAGE_TEXT})`,
    });
    expect(await (await browser.$('[data-testid="pdf-hit-current"]')).isExisting()).toBe(true);
    await field.setValue("absent");
    await browser.waitUntil(async () => (await count.getText()) === "No matches", {
      timeout: SHOWS_WITHIN_MS,
    });
    await browser.keys(["Escape"]);
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="pdf-find"]')).isExisting()),
      {
        timeout: SHOWS_WITHIN_MS,
      }
    );
  });

  it("a_link_asks_before_it_leaves_and_shows_the_whole_address", async () => {
    const dir = testDir("pdf-link");
    const file = path.join(dir, "link.pdf");
    writeFileSync(file, linkPagePdf());
    await openPdf(file);

    const box = await browser.$('[data-testid="pdf-link"]');
    await box.waitForExist({ timeout: SHOWS_WITHIN_MS });
    await box.click();
    const address = await browser.$('[data-testid="link-address"]');
    await address.waitForExist({ timeout: SHOWS_WITHIN_MS });
    expect(await address.getText()).toBe(LINK_ADDRESS);
    // Cancel hands nothing to the system.
    await (await browser.$("button=Cancel")).click();
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="link-prompt"]')).isExisting()),
      {
        timeout: SHOWS_WITHIN_MS,
      }
    );
  });

  it("remove_a_page_and_undo_it_and_the_merge_dialog_opens", async () => {
    const dir = testDir("pdf-pages");
    const file = path.join(dir, "three.pdf");
    writeFileSync(file, pagesPdf(3));
    await openPdf(file);
    const pageCount = async () =>
      (await browser.$$('[data-testid="pdf-pages"] [role="group"]')).length;
    expect(await pageCount()).toBe(3);

    // Choose the second page in the strip and remove it: the engine takes it out and the view
    // follows, with the copy question asked first, as for any first change.
    const second = await browser.$('[data-testid="pdf-thumbs"] button[aria-label="Page 2"]');
    await second.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await second.click();
    await browser.keys(["Delete"]);
    const without = await browser.$("button=Edit without a copy");
    await without.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await without.click();
    await browser.waitUntil(async () => (await pageCount()) === 2, {
      timeout: SHOWS_WITHIN_MS,
      timeoutMsg: "the page was not taken out",
    });

    // Undo gives it back.
    await browser.waitUntil(
      async () => {
        await browser.keys(["Control", "z"]);
        return (await pageCount()) === 3;
      },
      { timeout: SHOWS_WITHIN_MS, interval: 500, timeoutMsg: "undo did not give the page back" }
    );

    // Merge opens its dialog with this PDF first; the system's chooser is not driven here.
    await (await browser.$('button[aria-label="Merge PDFs…"]')).click();
    const dialog = await browser.$('[data-testid="pdf-merge-dialog"]');
    await dialog.waitForExist({ timeout: SHOWS_WITHIN_MS });
    // The name is cut with an ellipsis when it is long, which the driver's visible text leaves
    // out, so the row is read as it is and must have room on the screen.
    const row = (await browser.execute(
      "const e = document.querySelector('[data-testid=\"pdf-merge-dialog\"] .kern-pdf-job-path');" +
        "return e ? { text: e.textContent, width: e.getBoundingClientRect().width } : null;"
    )) as { text: string; width: number } | null;
    expect(row?.text).toBe("three.pdf (this PDF)");
    expect(row?.width ?? 0).toBeGreaterThan(40);
    await (await browser.$("button=Cancel")).click();
  });
});
