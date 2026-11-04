// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WireError, WirePath, WireSame } from "../ipc";
import {
  canDropOn,
  DROP_AREA_ATTR,
  decideDrop,
  dropTargetAt,
  DROP_DOCS_ATTR,
  dropTargetValue,
  editorLandingAt,
  landingAt,
  leftWindow,
  modsOf,
  parseDropTarget,
  planDrop,
  sentence,
  toCssPoint,
} from "./dnd";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const none = { ctrl: false, shift: false };

test("ctrl_copies_and_shift_moves", () => {
  expect(decideDrop({ ctrl: true, shift: false })).toBe("copy");
  expect(decideDrop({ ctrl: false, shift: true })).toBe("move");
});

test("a_modifier_overrides_what_the_other_application_offers", () => {
  expect(decideDrop({ ctrl: true, shift: false }, ["move"])).toBe("copy");
  expect(decideDrop({ ctrl: false, shift: true }, ["copy"])).toBe("move");
  expect(decideDrop({ ctrl: true, shift: false }, ["copy", "move"])).toBe("copy");
});

test("with_no_modifier_the_filesystems_decide", () => {
  expect(decideDrop(none)).toBe("by_filesystem");
  expect(decideDrop(null)).toBe("by_filesystem");
});

test("both_modifiers_decide_nothing_so_the_filesystems_do", () => {
  expect(decideDrop({ ctrl: true, shift: true })).toBe("by_filesystem");
});

test("an_application_that_offers_only_copy_or_only_move_is_obeyed_when_no_modifier_is_known", () => {
  expect(decideDrop(null, ["copy"])).toBe("copy");
  expect(decideDrop(null, ["move"])).toBe("move");
  // Link and ask are not Kern's to act on: only copy and move count.
  expect(decideDrop(null, ["copy", "link"])).toBe("copy");
  expect(decideDrop(null, ["move", "link", "ask"])).toBe("move");
});

test("an_application_that_offers_both_or_neither_leaves_it_to_the_filesystems", () => {
  expect(decideDrop(null, ["copy", "move"])).toBe("by_filesystem");
  expect(decideDrop(null, ["copy", "move", "link"])).toBe("by_filesystem");
  expect(decideDrop(null, [])).toBe("by_filesystem");
  expect(decideDrop(null, ["link"])).toBe("by_filesystem");
  expect(decideDrop(null, ["ask"])).toBe("by_filesystem");
});

const yes: WireSame = { state: "checked", same: true };
const no: WireSame = { state: "checked", same: false };
const wireError = (kind: string): WireError => ({ kind, message: kind, path: null, details: null });
const failed = (kind: string): WireSame => ({ state: "failed", error: wireError(kind) });

test("each_source_is_moved_copied_or_left_with_its_error_by_its_own_answer", () => {
  const [a, b, c, d] = [p("/s/a"), p("/s/b"), p("/s/c"), p("/s/d")] as [
    WirePath,
    WirePath,
    WirePath,
    WirePath,
  ];
  const plan = planDrop([a, b, c, d], [yes, no, failed("NotFound"), yes]);
  expect(plan.move).toEqual([a, d]);
  expect(plan.copy).toEqual([b]);
  expect(plan.failed).toEqual([{ path: c, error: wireError("NotFound") }]);
});

test("when_every_source_is_on_one_side_the_other_is_empty", () => {
  const sources = [p("/s/a"), p("/s/b")];
  expect(planDrop(sources, [yes, yes])).toEqual({ move: sources, copy: [], failed: [] });
  expect(planDrop(sources, [no, no])).toEqual({ move: [], copy: sources, failed: [] });
});

test("an_answer_count_that_does_not_match_the_sources_acts_on_nothing_and_says_so_for_each", () => {
  const sources = [p("/s/a"), p("/s/b")];
  const plan = planDrop(sources, [yes]);
  expect(plan.move).toEqual([]);
  expect(plan.copy).toEqual([]);
  expect(plan.failed.map((f) => f.path)).toEqual(sources);
  expect(plan.failed[0]!.error.kind).toBe("Internal");
  expect(plan.failed[0]!.error.message).toMatch(/1 answer.*2 sources/);
});

test("a_drop_target_is_the_path_it_was_made_from_including_a_non_utf8_one", () => {
  for (const path of [p('/a b/c"d'), { k: "Bytes", v: btoa("/d/\xff") } satisfies WirePath]) {
    expect(parseDropTarget(dropTargetValue(path))).toEqual(path);
  }
});

test("a_malformed_drop_target_is_no_target", () => {
  for (const v of [
    null,
    "",
    "{",
    "[]",
    '{"k":"Utf8"}',
    '{"k":"Other","v":"/x"}',
    '{"k":"Utf8","v":3}',
  ]) {
    expect(parseDropTarget(v), String(v)).toBeNull();
  }
});

test("the_drop_target_is_found_from_the_element_under_the_pointer_and_its_ancestors", () => {
  document.body.innerHTML = `<div id="row" data-drop-target='${dropTargetValue(p("/d/sub"))}'><span id="name">sub</span></div><p id="plain">x</p>`;
  const at = (id: string) => () => document.getElementById(id);
  expect(dropTargetAt(1, 1, at("name"))?.path).toEqual(p("/d/sub"));
  expect(dropTargetAt(1, 1, at("plain"))).toBeNull();
  expect(dropTargetAt(1, 1, () => null)).toBeNull();
});

test("an_item_cannot_be_dropped_on_itself", () => {
  expect(canDropOn([p("/d/a"), p("/d/b")], p("/d/b"))).toBe(false);
  expect(canDropOn([p("/d/a"), p("/d/b")], p("/d/c"))).toBe(true);
});

test("the_pointer_is_outside_the_window_beyond_any_edge", () => {
  expect(leftWindow(-1, 5, 800, 600)).toBe(true);
  expect(leftWindow(5, -1, 800, 600)).toBe(true);
  expect(leftWindow(800, 5, 800, 600)).toBe(true);
  expect(leftWindow(5, 600, 800, 600)).toBe(true);
  expect(leftWindow(0, 0, 800, 600)).toBe(false);
  expect(leftWindow(799, 599, 800, 600)).toBe(false);
});

test("a_drop_position_becomes_css_pixels_by_the_ratio_of_the_views_size_to_the_pages", () => {
  // A 1.25 zoom: the view is 1280 units wide and shows a page 1024 CSS pixels wide.
  const view = { width: 1280, height: 800 };
  expect(toCssPoint({ x: 100, y: 50 }, view, { width: 1024, height: 640 })).toEqual({
    x: 80,
    y: 40,
  });
  // 80 %: the same view shows a page 1600 wide.
  expect(toCssPoint({ x: 100, y: 50 }, view, { width: 1600, height: 1000 })).toEqual({
    x: 125,
    y: 62.5,
  });
  // 100 %: units and pixels are the same.
  expect(toCssPoint({ x: 7, y: 9 }, view, view)).toEqual({ x: 7, y: 9 });
});

test("a_drop_lands_on_the_same_row_at_every_interface_size", () => {
  // The row under the pointer is at CSS (300, 200) whatever the zoom: the view's size in its own
  // units is the page's size times the zoom, and so is the pointer's position.
  for (const zoom of [0.8, 0.9, 1, 1.1, 1.25]) {
    const page = { width: 1000, height: 700 };
    const view = { width: page.width * zoom, height: page.height * zoom };
    const at = toCssPoint({ x: 300 * zoom, y: 200 * zoom }, view, page);
    expect(at.x).toBeCloseTo(300, 9);
    expect(at.y).toBeCloseTo(200, 9);
  }
});

test.each([
  [0, 800, 1000, 700],
  [1000, 0, 1000, 700],
  [-5, 800, 1000, 700],
  [Number.NaN, 800, 1000, 700],
  [1000, 800, 0, 700],
  [1000, 800, 1000, Number.POSITIVE_INFINITY],
])("sizes_%s_by_%s_and_%s_by_%s_give_no_point", (vw, vh, cw, ch) => {
  expect(() =>
    toCssPoint({ x: 1, y: 1 }, { width: vw, height: vh }, { width: cw, height: ch })
  ).toThrow(RangeError);
});

test("the_modifier_a_drop_carries_becomes_the_keys_that_decide", () => {
  expect(modsOf("copy")).toEqual({ ctrl: true, shift: false });
  expect(modsOf("move")).toEqual({ ctrl: false, shift: true });
  expect(modsOf(null)).toBeNull();
  expect(decideDrop(modsOf("copy"), ["move"])).toBe("copy");
  expect(decideDrop(modsOf("move"), ["copy"])).toBe("move");
  expect(decideDrop(modsOf(null), ["copy", "move"])).toBe("by_filesystem");
});

// ---- where a drop from another application lands ----

const page = { width: 1000, height: 700 };
const view = { width: 1000, height: 700 };

function dom(html: string) {
  document.body.innerHTML = html;
}
const area = (folder: WirePath) => `${DROP_AREA_ATTR}='${dropTargetValue(folder)}'`;
const target = (folder: WirePath) => `data-drop-target='${dropTargetValue(folder)}'`;
const find = (id: string) => () => document.getElementById(id);

test("a_folder_row_under_the_pointer_is_where_the_drop_lands", () => {
  dom(
    `<div ${area(p("/d"))}><div id="row" ${target(p("/d/sub"))}><span id="n">sub</span></div></div>`
  );
  const l = landingAt({ x: 5, y: 5 }, view, page, null, find("n"));
  expect(l).toMatchObject({ ok: true, path: p("/d/sub"), kind: "item" });
  expect(l.ok && l.el.id).toBe("row");
});

test("a_folder_in_places_is_where_the_drop_lands", () => {
  dom(`<ul><li id="place" ${target(p("/home/u/Music"))}><button id="b">Music</button></li></ul>`);
  expect(landingAt({ x: 5, y: 5 }, view, page, null, find("b"))).toMatchObject({
    ok: true,
    path: p("/home/u/Music"),
  });
});

test("the_body_of_a_folder_view_is_the_folder_itself", () => {
  dom(`<div id="body" ${area(p("/d"))}><div id="gap"></div><div id="file">a</div></div>`);
  // A file row is not a drop target, so a drop on it is a drop on the body that holds it.
  for (const id of ["gap", "file", "body"]) {
    expect(landingAt({ x: 5, y: 5 }, view, page, null, find(id)), id).toMatchObject({
      ok: true,
      path: p("/d"),
      kind: "area",
    });
  }
});

test("anywhere_else_is_refused_with_a_reason_that_names_the_places_that_take_files", () => {
  dom(`<div id="bar">toolbar</div>`);
  const l = landingAt({ x: 5, y: 5 }, view, page, null, find("bar"));
  expect(l.ok).toBe(false);
  expect(!l.ok && l.reason).toMatch(/folder/);
  expect(!l.ok && l.reason).toMatch(/Places/);
  // Nothing at all under the point (outside the page) is the same.
  expect(landingAt({ x: 5, y: 5 }, view, page, null, () => null).ok).toBe(false);
});

test("a_place_whose_folder_cannot_be_read_is_refused_and_not_replaced_by_another", () => {
  dom(`<div ${area(p("/d"))}><div id="x" data-drop-target="{broken"></div></div>`);
  const l = landingAt({ x: 5, y: 5 }, view, page, null, find("x"));
  expect(l.ok).toBe(false);
  expect(!l.ok && l.reason).toMatch(/no folder of its own/);
});

test("a_view_whose_size_cannot_be_measured_refuses_and_says_so", () => {
  dom(`<div id="body" ${area(p("/d"))}></div>`);
  for (const bad of [
    { width: 0, height: 700 },
    { width: 1000, height: Number.NaN },
  ]) {
    const l = landingAt({ x: 5, y: 5 }, bad, page, null, find("body"));
    expect(l.ok).toBe(false);
    expect(!l.ok && l.reason).toMatch(/could not tell where/);
  }
});

test("the_point_is_found_in_css_pixels_at_any_interface_size", () => {
  dom(`<div ${area(p("/d"))}><div id="row" ${target(p("/d/sub"))}></div></div>`);
  const seen: Array<[number, number]> = [];
  const at = (x: number, y: number) => {
    seen.push([x, y]);
    return document.getElementById("row");
  };
  landingAt({ x: 375, y: 250 }, { width: 1250, height: 875 }, page, null, at);
  expect(seen).toEqual([[300, 200]]);
});

test("a_folder_cannot_be_dropped_into_itself_and_the_reason_says_so", () => {
  dom(`<div ${area(p("/d"))}><div id="row" ${target(p("/d/sub"))}></div></div>`);
  const l = landingAt({ x: 5, y: 5 }, view, page, [p("/d/sub")], find("row"));
  expect(l.ok).toBe(false);
  expect(!l.ok && l.reason).toMatch(/into itself/);
  expect(landingAt({ x: 5, y: 5 }, view, page, [p("/d/other")], find("row")).ok).toBe(true);
});

test("a_reason_from_the_backend_is_made_a_sentence", () => {
  expect(sentence("it names no files")).toBe("It names no files.");
  expect(sentence("Already a sentence.")).toBe("Already a sentence.");
  expect(sentence("ends with a question?")).toBe("Ends with a question?");
  expect(sentence("")).toBe("");
});

// ---- where a drop lands in an editor window ----

test("in_an_editor_window_a_folder_row_of_the_tree_is_where_the_drop_lands", () => {
  dom(
    `<aside><div id="row" ${target(p("/d/sub"))}><span id="n">sub</span></div></aside><section ${DROP_DOCS_ATTR}></section>`
  );
  const l = editorLandingAt({ x: 5, y: 5 }, view, page, null, find("n"));
  expect(l).toMatchObject({ ok: true, path: p("/d/sub"), kind: "item" });
});

test("in_an_editor_window_the_document_area_opens_what_is_dropped", () => {
  dom(`<section ${DROP_DOCS_ATTR}><div id="text">text</div><div id="tabs">tabs</div></section>`);
  for (const id of ["text", "tabs"]) {
    const l = editorLandingAt({ x: 5, y: 5 }, view, page, null, find(id));
    expect(l, id).toMatchObject({ ok: true, kind: "open" });
    expect(l.ok && l.el.hasAttribute(DROP_DOCS_ATTR)).toBe(true);
  }
});

test("in_an_editor_window_anywhere_else_is_refused_with_a_reason_naming_the_tree_and_the_documents", () => {
  dom(`<div id="bar">status</div><section ${DROP_DOCS_ATTR}></section>`);
  const l = editorLandingAt({ x: 5, y: 5 }, view, page, null, find("bar"));
  expect(l.ok).toBe(false);
  expect(!l.ok && l.reason).toMatch(/tree/);
  expect(!l.ok && l.reason).toMatch(/text file/);
  expect(editorLandingAt({ x: 5, y: 5 }, view, page, null, () => null).ok).toBe(false);
});

test("in_an_editor_window_a_folder_cannot_be_dropped_into_itself_and_an_unmeasurable_view_refuses", () => {
  dom(`<div id="row" ${target(p("/d/sub"))}></div>`);
  const l = editorLandingAt({ x: 5, y: 5 }, view, page, [p("/d/sub")], find("row"));
  expect(!l.ok && l.reason).toMatch(/itself/);
  const bad = editorLandingAt({ x: 5, y: 5 }, { width: 0, height: 0 }, page, null, find("row"));
  expect(!bad.ok && bad.reason).toMatch(/could not tell where/);
});
