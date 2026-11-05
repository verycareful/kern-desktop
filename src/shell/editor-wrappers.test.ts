// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vitest";

// A static look at what an editor window can send. editor-grants.test.tsx runs the page and sees
// the commands its script drives; this one reads the code: every command wrapper (src/ipc) that
// a file the editor window mounts imports must be granted to `editor-*` in capabilities/editor.json
// or be on the list below of commands the editor window never sends, each with the reason. A new
// import of a wrapper fails here until it is granted or put on the list on purpose.

const ROOT = process.cwd();
const SRC = resolve(ROOT, "src");
const ENTRY = resolve(SRC, "shell/EditorWindow.tsx");

/** Wrapper name to the permission that grants its command. */
function wrapperPermissions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of ["ipc/app.ts", "ipc/kernkraft.ts"]) {
    const text = readFileSync(resolve(SRC, file), "utf8");
    // `export const name = (...) => invoke<T>("cmd", ...)` or `invoke<T>(cmd("cmd"), ...)`, over
    // as many lines as the statement takes.
    for (const part of text.split(/\n(?=export const )/)) {
      const m =
        /^export const (\w+)\b[\s\S]*?\binvoke(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*(cmd\()?"(\w+)"/.exec(
          part
        );
      if (!m) continue;
      const dashed = m[3]!.replace(/_/g, "-");
      out.set(m[1]!, m[2] ? `kernkraft-tauri:allow-${dashed}` : `allow-${dashed}`);
    }
  }
  return out;
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** The value imports of a file: `[module path, imported names]`. Type-only imports send nothing. */
function importsOf(file: string): Array<[string, string[]]> {
  const text = readFileSync(file, "utf8");
  const found: Array<[string, string[]]> = [];
  for (const m of text.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+"(\.[^"]*)"/gms)) {
    if (m[1]) continue;
    const target = resolveModule(file, m[3]!);
    if (!target) continue;
    const braces = /\{([^}]*)\}/.exec(m[2]!);
    const names = braces
      ? braces[1]!
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "))
          .map((n) => n.split(/\s+as\s+/)[0]!)
      : [];
    found.push([target, names]);
  }
  // `export * from` and `export { } from` re-export what they name.
  for (const m of text.matchAll(/^export\s+(?:\*|\{[^}]*\})\s+from\s+"(\.[^"]*)"/gm)) {
    const target = resolveModule(file, m[1]!);
    if (target) found.push([target, []]);
  }
  return found;
}

/** Every wrapper imported, by name, from the ipc modules in the files `entry` reaches. */
function importedWrappers(entry: string, known: Set<string>): Set<string> {
  const seen = new Set<string>();
  const wrappers = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || /\.test\.tsx?$/.test(file)) return;
    seen.add(file);
    for (const [target, names] of importsOf(file)) {
      if (target.startsWith(resolve(SRC, "ipc"))) {
        for (const n of names) if (known.has(n)) wrappers.add(n);
        continue;
      }
      visit(target);
    }
  };
  visit(entry);
  return wrappers;
}

/**
 * The commands a file the editor window mounts imports and the editor window never sends. The
 * window mounts the places strip, whose folder area, Trash, Library and Settings tabs belong to the
 * main window, and the shared file operations; an editor window has document tabs, the folder
 * tree with its file operations, search and terminal, and the strip's Places and mounted Volumes
 * (src/shell/EditorWindow.tsx).
 */
const NOT_FOR_EDITORS: Record<string, string[]> = {
  "folder tabs, the Library, the Trash, Open with and thumbnails exist only in the main window": [
    "allApps",
    "appsFor",
    "documents",
    "launchApp",
    "setDefaultApp",
    "thumbCancel",
    "thumbRequest",
    "trashList",
    "trashPurge",
    "trashRestore",
  ],
  "drags out of Kern start from the folder view": ["dragOut"],
  "mounting, unmounting and ejecting are buttons of the main window's strip": [
    "volumeEject",
    "volumeMount",
    "volumeUnmount",
  ],
  "kernkraft's start_op takes any kind of operation, empty Trash among them; the editor window starts a copy or a move through dropStartOp and a trash or delete of given items through removeStartOp":
    ["startOp"],
  "Undo and Redo run from the Edit menu, which only the main window has": ["redo", "undo"],
  "only the main window stores its layout": ["layoutSet"],
  "Home belongs to a document window": ["moveDocToMain"],
};

const granted = (): Set<string> => {
  const json = JSON.parse(
    readFileSync(resolve(ROOT, "src-tauri/capabilities/editor.json"), "utf8")
  );
  return new Set<string>(json.permissions);
};

test("every_wrapper_a_file_the_editor_window_mounts_imports_is_granted_or_listed", () => {
  const permissions = wrapperPermissions();
  expect(permissions.size).toBeGreaterThan(40);
  const imported = importedWrappers(ENTRY, new Set(permissions.keys()));
  // The walk reaches the page's real imports.
  for (const must of [
    "listDir",
    "textOpen",
    "docOpened",
    "openPaths",
    "dropStartOp",
    "removeStartOp",
  ]) {
    expect(imported, must).toContain(must);
  }
  const listed = new Set(Object.values(NOT_FOR_EDITORS).flat());
  const ok = granted();
  const unclassified = [...imported]
    .filter((w) => !ok.has(permissions.get(w)!) && !listed.has(w))
    .sort();
  expect(unclassified).toEqual([]);
  // The list stays honest: nothing on it is granted, and everything on it is still imported.
  const granted_but_listed = [...listed].filter((w) => ok.has(permissions.get(w) ?? ""));
  expect(granted_but_listed).toEqual([]);
  const stale = [...listed].filter((w) => !imported.has(w));
  expect(stale).toEqual([]);
});
