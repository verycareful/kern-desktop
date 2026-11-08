// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { ErrorBanner } from "../ops/ErrorBanner";
import { useOpenError } from "../ops/open-error-store";

/**
 * The message about a file that could not be opened from the folder tree, in the middle of the
 * editor area and above whatever is open there (shell.css .kern-open-error positions it).
 */
export function OpenError() {
  const lines = useOpenError((s) => s.lines);
  const dismiss = useOpenError((s) => s.dismiss);
  if (lines.length === 0) return null;
  return (
    <div className="kern-open-error" data-testid="open-error">
      <ErrorBanner onDismiss={dismiss} watch={lines}>
        <ul>
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </ErrorBanner>
    </div>
  );
}
