// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { countHits, positionOf } from "./find";
import { usePdfFind } from "./pdf-find";

// The find bar above the pages: the question, the two options, the number of matches and the
// way from one to the next. Enter and F3 go to the next match, Shift+Enter and Shift+F3 to the
// previous, Ctrl+F selects the question again, Escape closes the bar. The search is run by `useFindSearch`; this only shows it.
export function FindBar(props: { tabId: string }) {
  const { tabId } = props;
  const find = usePdfFind((s) => s.byTab[tabId]);
  const input = useRef<HTMLInputElement>(null);
  const focus = find?.focus ?? 0;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focus]);
  if (!find?.open) return null;
  const { query, caseSensitive, wholeWord, hits, current, searching, error } = find;
  const total = countHits(hits);
  const store = usePdfFind.getState();

  let status = "";
  if (error) status = error;
  else if (query.trim() === "") status = "";
  else if (total > 0) {
    const at = positionOf(hits, current);
    status = `${at} of ${total}${searching ? "+" : ""}`;
  } else status = searching ? "Searching…" : "No matches";

  return (
    <div
      className="kern-pdf-find"
      role="search"
      aria-label="Find in the document"
      data-testid="pdf-find"
    >
      <input
        ref={input}
        type="search"
        className="kern-modal-input kern-pdf-find-input"
        aria-label="Find"
        placeholder="Find in the document"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => store.setQuery(tabId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            store.step(tabId, e.shiftKey ? -1 : 1);
          } else if (e.key === "F3") {
            e.preventDefault();
            store.step(tabId, e.shiftKey ? -1 : 1);
          } else if (e.key.toLowerCase() === "f" && e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            e.currentTarget.select();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            store.close(tabId);
          }
        }}
      />
      <button
        type="button"
        className="kern-button kern-pdf-find-option"
        aria-pressed={caseSensitive}
        onClick={() => store.setCaseSensitive(tabId, !caseSensitive)}
      >
        Match case
      </button>
      <button
        type="button"
        className="kern-button kern-pdf-find-option"
        aria-pressed={wholeWord}
        onClick={() => store.setWholeWord(tabId, !wholeWord)}
      >
        Whole word
      </button>
      <span
        className="kern-pdf-find-count"
        role="status"
        aria-live="polite"
        data-testid="pdf-find-count"
      >
        {status}
      </span>
      <button
        type="button"
        className="kern-pdf-tool"
        aria-label="Previous match"
        title="Previous match (Shift+F3)"
        disabled={total === 0}
        onClick={() => store.step(tabId, -1)}
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="kern-pdf-tool"
        aria-label="Next match"
        title="Next match (F3)"
        disabled={total === 0}
        onClick={() => store.step(tabId, 1)}
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="kern-pdf-tool"
        aria-label="Close find"
        title="Close (Escape)"
        onClick={() => store.close(tabId)}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
