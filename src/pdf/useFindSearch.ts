// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import { toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { cancelFind, findAll } from "./find";
import { nextJobId } from "./jobs";
import { pdfController } from "./pdf-controller";
import { usePdfFind } from "./pdf-find";
import { usePdfSelection } from "./pdf-selection";
import { usePdfView } from "./pdf-view";
import type { PdfDoc } from "./usePdfDoc";

// Runs the search of a PDF tab while its find bar is open: a new question, a change of the two
// options or an edit to the document stops the search in flight and starts another, and the page
// of the current match is brought into view. Mounted by the viewer for as long as the tab is open.
export function useFindSearch(tabId: string, doc: PdfDoc): void {
  const find = usePdfFind((s) => s.byTab[tabId]);
  const open = find?.open ?? false;
  const query = find?.query ?? "";
  const caseSensitive = find?.caseSensitive ?? false;
  const wholeWord = find?.wholeWord ?? false;
  const { handle, revision, phase } = doc;
  const docNow = useRef(doc);
  useEffect(() => {
    docNow.current = doc;
  });

  useEffect(() => {
    const store = usePdfFind.getState();
    store.reset(tabId);
    if (!open || query.trim() === "" || handle === undefined || phase !== "ready") return;
    let live = true;
    const job = nextJobId();
    const shown = usePdfView.getState().byTab[tabId]?.page ?? 0;
    store.begin(tabId);
    findAll(
      docNow.current,
      query,
      { caseSensitive, wholeWord, from: shown },
      (page, matches) => {
        if (live) usePdfFind.getState().report(tabId, page, matches);
      },
      job
    ).then(
      () => {
        if (live) usePdfFind.getState().finish(tabId, null);
      },
      (e: unknown) => {
        if (live) usePdfFind.getState().finish(tabId, errorText(toWireError(e)));
      }
    );
    return () => {
      live = false;
      void cancelFind(job);
    };
    // An edit to the document (its revision) searches it again.
  }, [tabId, open, query, caseSensitive, wholeWord, handle, revision, phase]);

  // The current match is brought into view when it changes.
  const current = find?.current ?? null;
  const rects = current ? find?.hits[current.page]?.[current.index]?.rects : undefined;
  const top = rects?.[0]?.[1];
  useEffect(() => {
    if (!current || top === undefined) return;
    pdfController(tabId)?.goToPage(current.page, top);
    // The view follows the match, not the other matches of the page.
  }, [tabId, current?.page, current?.index, top]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search for the selected text opens the bar with it.
  const request = usePdfSelection((s) => s.searches[tabId]);
  const seen = useRef(request?.seq ?? 0);
  useEffect(() => {
    if (!request || request.seq === seen.current) return;
    seen.current = request.seq;
    // A line break or a run of blanks in the selection is one blank in the question.
    usePdfFind.getState().open(tabId, request.text.replace(/\s+/g, " ").trim());
  }, [request, tabId]);

  useEffect(() => () => usePdfFind.getState().forget(tabId), [tabId]);
}
