// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Page } from "@playwright/test";
import { test, expect } from "./support/mockInvoke";

// File operations through the production build with an in-page stand-in for the
// backend (design 5.1, 5.7). The stand-in keeps folders as lists of entries,
// answers the commands the operations use, and delivers kernkraft://dir-changed
// and the op-* events the way the plugin does. The mocks are serialised into the
// page, so each is self-contained and reaches the stand-in through window.__fake.

type WirePath = { k: "Utf8" | "Bytes"; v: string };
type Entry = {
  path: WirePath;
  name: string;
  kind: string;
  target_is_dir?: boolean;
  len?: number;
  modified_ms?: number | null;
  hidden?: boolean;
  mime?: string;
};

const SETTINGS = {
  follow: { colours: true, accent: true, fonts: true, radius: true },
  theme_mode: "system",
  accent: "slate",
  density: "cozy",
  show_hidden: false,
  view_mode: "list",
  interface_size: 90,
};

/** Defines window.__fake before the app starts: `dirs` maps "Utf8:/folder" to its entries. */
async function installFake(page: Page, dirs: Record<string, Entry[]>) {
  await page.addInitScript((initial) => {
    const w = window as unknown as {
      __fake: unknown;
      __tauriEmit: (e: string, p: unknown) => void;
    };
    const key = (p: WirePath) => `${p.k}:${p.v}`;
    const full = (e: Entry): Entry => ({
      target_is_dir: e.kind === "dir",
      len: 10,
      modified_ms: null,
      hidden: false,
      mime: e.kind === "dir" ? "inode/directory" : "text/plain",
      ...e,
    });
    const fake = {
      dirs: Object.fromEntries(
        Object.entries(initial).map(([k, list]) => [k, (list as Entry[]).map(full)])
      ) as Record<string, Entry[]>,
      watchKey: null as string | null,
      nextOp: 1,
      clip: null as unknown,
      journal: [] as Array<{ label: string; items: Array<{ dir: string; entry: unknown }> }>,
      redo: [] as Array<{ label: string; items: Array<{ dir: string; entry: unknown }> }>,
      pending: null as unknown,
      key,
      full,
      // The folder an item is in, as a key. A bytes path is split on its raw bytes, and the folder
      // is taken to be text, which is all these tests need.
      parentKey(p: WirePath) {
        const text = p.k === "Bytes" ? atob(p.v) : p.v;
        return `Utf8:${text.slice(0, text.lastIndexOf("/")) || "/"}`;
      },
      changed() {
        setTimeout(() => w.__tauriEmit("kernkraft://dir-changed", { key: fake.watchKey }), 5);
      },
      finish(op: number, report: object) {
        w.__tauriEmit("kernkraft://op-done", {
          op,
          report: {
            done: [],
            skipped: [],
            failed: [],
            warnings: [],
            cancelled: false,
            not_reached: [],
            ...report,
          },
          properties: null,
          scan: null,
          error: null,
        });
      },
      /** Takes the entry at `path` out of its folder and returns it with the folder's key. */
      take(path: WirePath) {
        const dir = fake.parentKey(path);
        const list = fake.dirs[dir] ?? [];
        const at = list.findIndex((e: Entry) => key(e.path) === key(path));
        if (at < 0) return null;
        return { dir, entry: list.splice(at, 1)[0] };
      },
      put(dir: string, entry: Entry) {
        (fake.dirs[dir] ??= []).push(entry);
      },
    };
    w.__fake = fake;
  }, dirs);
}

type Fake = {
  dirs: Record<string, Entry[]>;
  watchKey: string | null;
  nextOp: number;
  clip: unknown;
  journal: Array<{ label: string; items: Array<{ dir: string; entry: Entry }> }>;
  redo: Array<{ label: string; items: Array<{ dir: string; entry: Entry }> }>;
  pending: {
    op: number;
    source: WirePath;
    existing: Entry;
    dest: string;
    entry: Entry;
  } | null;
  key(p: WirePath): string;
  full(e: Entry): Entry;
  parentKey(p: WirePath): string;
  changed(): void;
  finish(op: number, report: object): void;
  take(path: WirePath): { dir: string; entry: Entry } | null;
  put(dir: string, entry: Entry): void;
};
declare global {
  interface Window {
    __fake: Fake;
  }
}

const K = "plugin:kernkraft-tauri|";
const BACKEND = {
  open_pending_take: [],
  settings_get: SETTINGS,
  settings_set: (args: Record<string, unknown>) => ({
    follow: { colours: true, accent: true, fonts: true, radius: true },
    theme_mode: "system",
    accent: "slate",
    density: "cozy",
    show_hidden: false,
    view_mode: "list",
    interface_size: 90,
    ...(args.patch as object),
  }),
  [`${K}volumes_list`]: { mounted: [], unmounted: [], problems: [] },
  [`${K}user_dirs`]: { home: { k: "Utf8", v: "/home/tester" }, dirs: [] },
  [`${K}theme_get`]: { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  [`${K}unwatch_dir`]: null,
  [`${K}watch_dir`]: (args: Record<string, unknown>) => {
    window.__fake.watchKey = args.key as string;
    return null;
  },
  [`${K}list_dir`]: (args: Record<string, unknown>) =>
    window.__fake.dirs[window.__fake.key(args.path as WirePath)] ?? [],
  clip_set: (args: Record<string, unknown>) => {
    window.__fake.clip = { op: args.op, paths: args.paths };
    return null;
  },
  clip_get: () => window.__fake.clip,
  [`${K}undo_state`]: () => {
    const f = window.__fake;
    const top = f.journal[f.journal.length - 1];
    const next = f.redo[f.redo.length - 1];
    return {
      undo: top ? `Undo ${top.label}` : null,
      redo: next ? `Redo ${next.label}` : null,
    };
  },
  [`${K}undo`]: () => {
    const f = window.__fake;
    const top = f.journal.pop();
    if (!top)
      throw { kind: "NothingToUndo", message: "nothing to undo", path: null, details: null };
    for (const i of top.items) f.put(i.dir, i.entry);
    f.redo.push(top);
    f.changed();
    return { done: top.items.map((i) => i.entry.path), warnings: [] };
  },
  [`${K}start_op`]: (args: Record<string, unknown>) => {
    const f = window.__fake;
    const op = f.nextOp++;
    const sources = args.sources as WirePath[];
    const dest = args.dest as WirePath | null;
    const kind = args.kind as string;
    setTimeout(() => {
      if (kind === "trash") {
        const items = sources.flatMap((s) => f.take(s) ?? []);
        const names = items.map((i) => i.entry.name);
        f.journal.push({ label: `trash of ${names.join(", ")}`, items });
        f.changed();
        f.finish(op, { done: items.map((i) => ({ source: i.entry.path, dest: null })) });
      } else if (kind === "delete") {
        const items = sources.flatMap((s) => f.take(s) ?? []);
        f.changed();
        f.finish(op, { done: items.map((i) => ({ source: i.entry.path, dest: null })) });
      } else if (kind === "copy" && dest) {
        const dir = f.key(dest);
        const first = sources[0] as WirePath;
        const name = first.v.slice(first.v.lastIndexOf("/") + 1);
        const existing = (f.dirs[dir] ?? []).find((e) => e.name === name);
        const source: Entry = f.full({ path: first, name, kind: "file" });
        if (existing) {
          f.pending = { op, source: first, existing, dest: dir, entry: source };
          (window as unknown as { __tauriEmit: (e: string, p: unknown) => void }).__tauriEmit(
            "kernkraft://op-conflict",
            {
              op,
              conflict: 1,
              source: first,
              existing: existing.path,
              source_entry: source,
              existing_entry: existing,
            }
          );
        } else {
          const copy = f.full({ path: { k: "Utf8", v: `${dest.v}/${name}` }, name, kind: "file" });
          f.put(dir, copy);
          f.changed();
          f.finish(op, { done: [{ source: first, dest: copy.path }] });
        }
      } else if (kind === "failing") {
        f.finish(op, {});
      }
    }, 20);
    return op;
  },
  [`${K}answer_conflict`]: (args: Record<string, unknown>) => {
    const f = window.__fake;
    const pending = f.pending;
    f.pending = null;
    setTimeout(() => {
      if (!pending) return;
      if (args.choice === "keep_both") {
        const name = pending.entry.name.replace(/(\.[^.]*)?$/, " (2)$1");
        const copy = f.full({
          path: { k: "Utf8", v: `${pending.dest.slice(5)}/${name}` },
          name,
          kind: "file",
        });
        f.put(pending.dest, copy);
        f.changed();
        f.finish(pending.op, { done: [{ source: pending.source, dest: copy.path }] });
      } else {
        f.finish(pending.op, { skipped: [pending.source] });
      }
    }, 20);
    return null;
  },
  [`${K}rename`]: (args: Record<string, unknown>) => {
    const f = window.__fake;
    const taken = f.take(args.path as WirePath);
    if (!taken) throw { kind: "NotFound", message: "gone", path: null, details: null };
    const parent = taken.dir.slice(taken.dir.indexOf(":") + 1);
    const path: WirePath = { k: "Utf8", v: `${parent === "/" ? "" : parent}/${args.newName}` };
    f.put(taken.dir, { ...taken.entry, name: args.newName as string, path });
    f.changed();
    return path;
  },
};

const rows = (page: Page) => page.getByTestId("file-row");
const rowNamed = (page: Page, name: string) =>
  page.locator(`[data-testid="file-row"][data-name="${name}"]`);
const file = (dir: string, name: string): Entry => ({
  path: { k: "Utf8", v: `${dir}/${name}` },
  name,
  kind: "file",
});
const folder = (dir: string, name: string): Entry => ({
  path: { k: "Utf8", v: `${dir}/${name}` },
  name,
  kind: "dir",
});

async function startedOps(page: Page) {
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __tauriCalls: Array<{ cmd: string; args: Record<string, unknown> }> })
        .__tauriCalls
  );
  return calls.filter((c) => c.cmd === `${K}start_op`).map((c) => c.args);
}

test("copy_paste_with_conflict_keep_both", async ({ page, mockTauri, invokeCalls }) => {
  const home = "/home/tester";
  await installFake(page, {
    [`Utf8:${home}`]: [file(home, "a.txt"), folder(home, "sub")],
    [`Utf8:${home}/sub`]: [file(`${home}/sub`, "a.txt")],
  });
  await mockTauri(BACKEND);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);

  await rowNamed(page, "a.txt").click();
  await page.keyboard.press("Control+c");
  await expect(page.getByTestId("status-notice")).toHaveText("Copied a.txt to the clipboard");
  expect((await invokeCalls()).find((c) => c.cmd === "clip_set")?.args).toEqual({
    op: "copy",
    paths: [{ k: "Utf8", v: `${home}/a.txt` }],
  });

  await rowNamed(page, "sub").dblclick();
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("folder-list").focus();
  await page.keyboard.press("Control+v");

  const dialog = page.getByRole("alertdialog", { name: "Name already taken" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${home}/sub/a.txt`);
  await expect(dialog.getByRole("button", { name: "Skip" })).toBeFocused();
  await dialog.getByRole("checkbox", { name: "Apply to all" }).check();
  await dialog.getByRole("button", { name: "Keep both" }).click();

  await expect(dialog).toBeHidden();
  const answer = (await invokeCalls()).find((c) => c.cmd === `${K}answer_conflict`);
  expect(answer?.args).toEqual({ op: 1, conflict: 1, choice: "keep_both", applyToAll: true });
  await expect(rows(page)).toHaveCount(2);
  // The copy that was made is the selection, and nothing was reported.
  await expect(rowNamed(page, "a (2).txt")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("report-dialog")).toHaveCount(0);
  expect((await startedOps(page))[0]).toMatchObject({
    kind: "copy",
    dest: { k: "Utf8", v: `${home}/sub` },
  });
});

test("skipping_a_conflict_ends_in_a_report_that_lists_the_skipped_item", async ({
  page,
  mockTauri,
}) => {
  const home = "/home/tester";
  await installFake(page, {
    [`Utf8:${home}`]: [file(home, "a.txt"), folder(home, "sub")],
    [`Utf8:${home}/sub`]: [file(`${home}/sub`, "a.txt")],
  });
  await mockTauri(BACKEND);
  await page.goto("/");
  await rowNamed(page, "a.txt").click();
  await page.keyboard.press("Control+c");
  await rowNamed(page, "sub").dblclick();
  await page.getByTestId("folder-list").focus();
  await page.keyboard.press("Control+v");
  await page
    .getByRole("alertdialog", { name: "Name already taken" })
    .getByRole("button", { name: "Skip" })
    .click();

  const report = page.getByTestId("report-dialog");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("report-skipped")).toHaveText(`${home}/a.txt`);
  await expect(report.getByRole("button", { name: "Close" })).toBeFocused();
  // Escape closes it; the focus goes back to the list.
  await page.keyboard.press("Escape");
  await expect(report).toBeHidden();
});

test("trash_then_undo_restores", async ({ page, mockTauri }) => {
  const home = "/home/tester";
  await installFake(page, { [`Utf8:${home}`]: [file(home, "a.txt"), file(home, "b.txt")] });
  await mockTauri(BACKEND);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);

  await rowNamed(page, "a.txt").click();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("status-notice")).toHaveText("Moved a.txt to the Trash");
  // Nothing was asked: Delete is undoable.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The Edit entries name what they would do.
  await page.getByTestId("folder-scroll").click({ button: "right", position: { x: 5, y: 150 } });
  await expect(page.getByRole("menuitem", { name: /^Undo trash of a\.txt/ })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: /^Redo/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByTestId("folder-list").focus();
  await page.keyboard.press("Control+z");
  await expect(rows(page)).toHaveCount(2);
  await expect(rowNamed(page, "a.txt")).toBeVisible();
  await expect(page.getByTestId("status-notice")).toHaveText("Undone: trash of a.txt");
});

test("non_utf8_name_renames", async ({ page, mockTauri, invokeCalls }) => {
  const home = "/home/tester";
  // The file is /home/tester/bad<0xFF>.txt: not UTF-8, so its path is bytes and its name shows U+FFFD.
  const bytes = Buffer.concat([
    Buffer.from(`${home}/bad`),
    Buffer.from([0xff]),
    Buffer.from(".txt"),
  ]);
  const raw: WirePath = { k: "Bytes", v: bytes.toString("base64") };
  await installFake(page, {
    [`Utf8:${home}`]: [{ path: raw, name: "bad\ufffd.txt", kind: "file" }, file(home, "b.txt")],
  });
  await mockTauri(BACKEND);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);

  await rowNamed(page, "bad\ufffd.txt").click();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: /^Rename bad/ });
  await expect(input).toBeFocused();
  await input.fill("good.txt");
  await input.press("Enter");

  // The real bytes went to the backend, with the new name as text.
  await expect
    .poll(async () => (await invokeCalls()).find((c) => c.cmd === `${K}rename`)?.args)
    .toEqual({ path: raw, newName: "good.txt" });
  await expect(rowNamed(page, "good.txt")).toHaveAttribute("aria-selected", "true");
  await expect(input).toBeHidden();
});

test("permanent_delete_confirms", async ({ page, mockTauri }) => {
  const home = "/home/tester";
  await installFake(page, { [`Utf8:${home}`]: [file(home, "a.txt"), file(home, "b.txt")] });
  await mockTauri(BACKEND);
  await page.goto("/");
  await rowNamed(page, "b.txt").click();

  await page.keyboard.press("Shift+Delete");
  const ask = page.getByRole("alertdialog", { name: "Delete permanently" });
  await expect(ask).toContainText("b.txt");
  await expect(ask).toContainText("cannot be undone");
  expect(await startedOps(page)).toEqual([]);

  // No is the answer the focus is on.
  await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ask).toBeHidden();
  expect(await startedOps(page)).toEqual([]);
  await expect(rows(page)).toHaveCount(2);

  await page.getByTestId("folder-list").focus();
  await page.keyboard.press("Shift+Delete");
  await ask.getByRole("button", { name: "Delete 1 item" }).click();
  await expect(rows(page)).toHaveCount(1);
  const ops = await startedOps(page);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ kind: "delete", sources: [{ k: "Utf8", v: `${home}/b.txt` }] });
});

test("delete_with_only_an_outline_does_nothing", async ({ page, mockTauri }) => {
  const home = "/home/tester";
  await installFake(page, { [`Utf8:${home}`]: [file(home, "a.txt"), file(home, "b.txt")] });
  await mockTauri(BACKEND);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  await page.getByTestId("folder-list").focus();
  await expect(rowNamed(page, "a.txt")).toHaveClass(/kern-cursor/);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Shift+Delete");
  await page.keyboard.press("F2");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(await startedOps(page)).toEqual([]);
  await expect(rows(page)).toHaveCount(2);
});

test("delete_in_the_places_strip_does_nothing_to_the_folders_selection", async ({
  page,
  mockTauri,
}) => {
  const home = "/home/tester";
  await installFake(page, { [`Utf8:${home}`]: [file(home, "a.txt"), file(home, "b.txt")] });
  await mockTauri(BACKEND);
  await page.goto("/");
  await rowNamed(page, "a.txt").click();
  // The keyboard is in the strip now, with a.txt still selected in the folder.
  await page.getByTestId("places-strip").getByRole("button", { name: "Trash" }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Shift+Delete");
  await page.keyboard.press("Control+x");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await startedOps(page)).toEqual([]);
  await expect(rows(page)).toHaveCount(2);
  // The same key in the view does act.
  await rowNamed(page, "a.txt").click();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(1);
});
