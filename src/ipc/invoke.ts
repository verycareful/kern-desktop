// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { WirePath } from "./wire-path";

// Mirrors kernkraft-tauri's WireError (src/error.rs). `kind` is the name of
// the error variant; a call Tauri itself rejects (missing key, ACL denial,
// unknown command) arrives as a plain string and is turned into kind "Ipc".
export interface WireError {
  kind: string;
  message: string;
  path?: WirePath | null;
  details?: WireDetails | null;
}

export interface WireItemError {
  path: WirePath;
  error: WireError;
}

// kernkraft-tauri's WireDetails: serde tag "k", fields as written in Rust.
export type WireDetails =
  | {
      k: "Partial";
      done: WirePath[];
      not_done: WirePath[];
      cause: WireError;
      warnings: WireItemError[];
    }
  | { k: "SourceNotRemoved"; copy: WirePath; left: WirePath; cause: WireError }
  | { k: "XattrsNotKept"; names: string[] }
  | { k: "Changed"; what: string }
  | { k: "Irreversible"; reason: string }
  | { k: "ReadOnly"; reason: string }
  | {
      k: "EjectIncomplete";
      unmounted: WirePath[];
      locked: string[];
      failed: string;
      cause: WireError;
    };

export function isWireError(e: unknown): e is WireError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { kind?: unknown }).kind === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

// Normalises whatever a rejected invoke carries into a WireError.
export function toWireError(e: unknown): WireError {
  if (isWireError(e)) return e;
  if (typeof e === "string") return { kind: "Ipc", message: e };
  if (e instanceof Error) return { kind: "Ipc", message: e.message };
  return { kind: "Ipc", message: String(e) };
}

// The one place a command is invoked. Arguments are camelCase, as Tauri maps
// them onto the commands' snake_case parameters. A failure rejects with a
// WireError.
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (e) {
    throw toWireError(e);
  }
}
