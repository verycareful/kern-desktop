// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useRef, useState } from "react";
import { Modal } from "../ops/Modal";
import { parsePage } from "./page-number";

/**
 * Asks for a page number. `onGo` gets it counted from 0. A value that is blank, not a number or
 * outside the file stays in the box with the reason under it: it is never taken for the nearest
 * page.
 */
export function GoToPage(props: {
  pages: number;
  /** The page in view, counted from 0, shown as the starting value. */
  current: number;
  onGo(page: number): void;
  onCancel(): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(props.current + 1));
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const parsed = parsePage(text, props.pages);
    if ("problem" in parsed) setProblem(parsed.problem);
    else props.onGo(parsed.page - 1);
  };
  return (
    <Modal
      role="dialog"
      label="Go to page"
      initialFocus={input}
      onEscape={props.onCancel}
      testId="go-to-page"
    >
      <h2 className="kern-modal-title">Go to page</h2>
      <label className="kern-modal-text" htmlFor={`${id}-page`}>
        Page (1 to {props.pages.toLocaleString("en-US")})
      </label>
      <input
        id={`${id}-page`}
        ref={input}
        type="text"
        inputMode="numeric"
        className="kern-modal-input"
        autoComplete="off"
        spellCheck={false}
        value={text}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      {problem && (
        <p id={`${id}-problem`} role="alert" className="kern-modal-error">
          {problem}
        </p>
      )}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={submit}>
          Go
        </button>
        <button type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
