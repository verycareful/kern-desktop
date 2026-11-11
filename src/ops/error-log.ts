// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { errorLogAppend, toWireError } from "../ipc";
import { errorText } from "./error-text";

/**
 * Adds a line to the error log (error_log.rs) for something Kern has just shown the user as an
 * error. The window does not wait for it. A line the log could not keep is said on the console
 * with the reason, since nothing else shows it.
 */
export function logError(source: string, message: string): void {
  errorLogAppend(source, message).catch((e: unknown) =>
    console.error(
      `kern: the error log could not keep [${source}] ${message}: ${errorText(toWireError(e))}`
    )
  );
}
