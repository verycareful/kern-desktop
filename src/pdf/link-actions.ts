// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfLink } from "../ipc/pdf";
import { useOps } from "../ops/useOps";
import { classifyLink } from "./links";
import { pdfController } from "./pdf-controller";
import { useLinkPrompt } from "./pdf-link-prompt";

const say = (text: string) => useOps.getState().notify(text);

/**
 * Follows a link of tab `tabId`: a link to a page shows that page, a web, mail or phone address
 * asks first (`LinkPrompt`), and any other link is not followed and says so. `pages` is the
 * number of pages of the document.
 */
export function followLink(tabId: string, link: PdfLink, pages: number): void {
  const target = classifyLink(link);
  if (target.kind === "page") {
    if (target.page >= pages) {
      say("This link leads to a page that is not in the document");
      return;
    }
    pdfController(tabId)?.goToPage(target.page);
  } else if (target.kind === "external") {
    useLinkPrompt.getState().ask(tabId, target.url);
  } else {
    say(
      "Kern does not follow this link: it does not lead to a page, a web address, mail or a phone number"
    );
  }
}
