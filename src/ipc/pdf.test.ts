// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, describe, expect, test, vi } from "vitest";

const bridge = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge }));

import {
  PAGE_BASE,
  fromWirePage,
  pdfAnnotations,
  pdfApply,
  pdfExtract,
  pdfLinks,
  pdfOpen,
  pdfPageInfo,
  pdfRedo,
  pdfRender,
  pdfRenderSize,
  pdfSave,
  pdfSearch,
  pdfSplit,
  pdfText,
  pdfUndo,
  toWirePage,
} from "./pdf";
import type { WirePath } from "./wire-path";

const PATH: WirePath = { k: "Utf8", v: "/home/a/book.pdf" };
const cmd = (name: string) => `plugin:kernkraft-tauri|${name}`;

beforeEach(() => {
  bridge.mockReset();
  bridge.mockResolvedValue({});
});

describe("the page base", () => {
  test("pages_are_zero_based_in_the_app_and_converted_once_at_the_wire", async () => {
    // The wire counts pages from 1 (kernkraft-pdf Document::page: "counted from 1").
    expect(PAGE_BASE).toBe(1);
    expect(toWirePage(0)).toBe(1);
    expect(fromWirePage(1)).toBe(0);

    await pdfPageInfo(7, 0);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_page_info"), { handle: 7, page: 1 });
    await pdfText(7, 2, 5);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_text"), { handle: 7, page: 3, job: 5 });
    await pdfRenderSize(7, 4, [0, 0, 0.5, 0.5], 800);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_render_size"), {
      handle: 7,
      page: 5,
      region: [0, 0, 0.5, 0.5],
      widthPx: 800,
    });
  });

  test("the_pages_of_an_operation_and_of_its_answer_are_converted", async () => {
    bridge.mockResolvedValue({
      revision: 3,
      pages: 5,
      changed_pages: [1, 3],
      can_undo: true,
      can_redo: false,
      modified: true,
    });
    const answer = await pdfApply(7, { op: "rotate", pages: [0, 2], degrees: 90 });
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_apply"), {
      handle: 7,
      op: { op: "rotate", pages: [1, 3], degrees: 90 },
      job: undefined,
    });
    expect(answer.changed_pages).toEqual([0, 2]);

    await pdfApply(7, { op: "reorder", order: [2, 0, 1] });
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_apply"), {
      handle: 7,
      op: { op: "reorder", order: [3, 1, 2] },
      job: undefined,
    });
    await pdfApply(7, { op: "remove", pages: [4] });
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_apply"), {
      handle: 7,
      op: { op: "remove", pages: [5] },
      job: undefined,
    });
    await pdfApply(7, {
      op: "deleteAnnotation",
      page: 1,
      id: { object: 9, generation: 0 },
    });
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_apply"), {
      handle: 7,
      op: { op: "deleteAnnotation", page: 2, id: { object: 9, generation: 0 } },
      job: undefined,
    });
  });

  test("undo_and_redo_answer_the_pages_they_changed_from_zero", async () => {
    bridge.mockResolvedValue({
      revision: 4,
      pages: 5,
      changed_pages: [5],
      can_undo: false,
      can_redo: true,
      modified: false,
    });
    expect((await pdfUndo(7)).changed_pages).toEqual([4]);
    expect((await pdfRedo(7)).changed_pages).toEqual([4]);
  });

  test("a_link_to_a_page_of_the_document_answers_that_page_from_zero", async () => {
    bridge.mockResolvedValue({
      links: [
        { rects: [[0, 0, 1, 1]], page: 4, x: 0.1, y: 0.2, zoom: null },
        { rects: [[0, 0, 1, 1]], uri: "https://example.org/" },
      ],
    });
    const links = await pdfLinks(7, 0);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_links"), { handle: 7, page: 1 });
    expect(links[0]?.page).toBe(3);
    expect(links[1]?.page).toBeUndefined();
    expect(links[1]?.uri).toBe("https://example.org/");
  });

  test("extract_names_its_pages_from_the_wire_base_and_split_keeps_the_typed_ranges", async () => {
    bridge.mockResolvedValue(PATH);
    await pdfExtract({ path: PATH }, [0, 4], PATH);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_extract"), {
      source: { path: PATH },
      pages: [1, 5],
      out: PATH,
      job: undefined,
    });
    bridge.mockResolvedValue([PATH]);
    await pdfSplit({ path: PATH }, "1-3,5", PATH);
    expect(bridge).toHaveBeenLastCalledWith(cmd("pdf_split"), {
      source: { path: PATH },
      ranges: "1-3,5",
      outDir: PATH,
      job: undefined,
    });
  });
});

describe("the commands", () => {
  test("pdfOpen_sends_the_path_and_the_password_and_no_origin", async () => {
    // The plugin takes the window the document belongs to from the call itself.
    bridge.mockResolvedValue({ handle: 3, pages: 2, revision: 0, stamp: "s1:x" });
    const opened = await pdfOpen(PATH, "secret");
    expect(bridge).toHaveBeenCalledWith(cmd("pdf_open"), { path: PATH, password: "secret" });
    expect(opened).toEqual({ handle: 3, pages: 2, revision: 0, stamp: "s1:x" });
  });

  test("pdfRender_returns_the_bytes_as_a_Uint8Array", async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    bridge.mockResolvedValue(bytes.buffer);
    const picture = await pdfRender(7, 0, null, 100, 9);
    expect(bridge).toHaveBeenCalledWith(cmd("pdf_render"), {
      handle: 7,
      page: 1,
      region: null,
      widthPx: 100,
      job: 9,
    });
    expect(picture).toBeInstanceOf(Uint8Array);
    expect(Array.from(picture)).toEqual([1, 2, 3, 255]);
  });

  test("pdfRender_refuses_an_answer_that_is_not_bytes", async () => {
    bridge.mockResolvedValue({ width: 1 });
    await expect(pdfRender(7, 0, null, 100)).rejects.toMatchObject({ kind: "Ipc" });
  });

  test("pdfSearch_answers_the_matches_and_sends_the_flags", async () => {
    bridge.mockResolvedValue({ matches: [{ rects: [[0.1, 0.1, 0.2, 0.2]] }] });
    const found = await pdfSearch(7, 1, "kern", true, false, 4);
    expect(bridge).toHaveBeenCalledWith(cmd("pdf_search"), {
      handle: 7,
      page: 2,
      query: "kern",
      caseSensitive: true,
      wholeWord: false,
      job: 4,
    });
    expect(found).toEqual([{ rects: [[0.1, 0.1, 0.2, 0.2]] }]);
  });

  test("pdfAnnotations_answers_the_list", async () => {
    bridge.mockResolvedValue({ annotations: [] });
    expect(await pdfAnnotations(7, 0)).toEqual([]);
    expect(bridge).toHaveBeenCalledWith(cmd("pdf_annotations"), { handle: 7, page: 1 });
  });

  test("pdfSave_passes_what_the_save_expects_as_given", async () => {
    bridge.mockResolvedValue("s1:next");
    for (const expect_ of [
      { kind: "unchanged", stamp: "s1:opened" },
      { kind: "nothing" },
      { kind: "anything" },
    ] as const) {
      bridge.mockClear();
      await pdfSave(7, PATH, expect_, "D:20261125120000+05'30'");
      expect(bridge).toHaveBeenCalledWith(cmd("pdf_save"), {
        handle: 7,
        path: PATH,
        expect: expect_,
        modified: "D:20261125120000+05'30'",
        job: undefined,
      });
    }
  });

  test("a_failure_rejects_with_a_WireError", async () => {
    bridge.mockRejectedValue({
      kind: "WrongPassword",
      message: "the password is wrong",
      path: null,
      details: null,
    });
    await expect(pdfOpen(PATH)).rejects.toMatchObject({ kind: "WrongPassword" });
  });
});
