// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  settingsSet: vi.fn(),
}));
import { settingsSet, type WirePath } from "../ipc";
import { useViewSettings } from "../files/view-settings";
import { DEFAULT_PANELS } from "../pdf/panel-placement";
import { registerPdf, type PdfController } from "../pdf/pdf-controller";
import { testController } from "../pdf/test-doc";
import { SETTINGS } from "../settings/test-settings";
import { useTabs } from "../store/tabs";
import {
  candidateKeys,
  currentContext,
  findDuplicateBindings,
  getAction,
  isEnabled,
  runAction,
} from "./actions";

const p = (v: string): WirePath => ({ k: "Utf8", v });

const controller = (): PdfController => testController();

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useViewSettings.setState({ pdfLayout: "scroll", pdfGridAcross: 4, pdfPanels: DEFAULT_PANELS });
  vi.mocked(settingsSet).mockReset();
});

const openPdf = () => {
  useTabs.getState().openDoc(p("/a/book.pdf"), "pdf");
  return useTabs.getState().activeId as string;
};

test("the_pdf_actions_run_on_the_viewer_of_the_active_pdf", () => {
  const id = openPdf();
  const c = controller();
  const off = registerPdf(id, c);
  const ctx = currentContext();
  runAction(getAction("pdf.zoomIn"), ctx);
  runAction(getAction("pdf.zoomOut"), ctx);
  runAction(getAction("pdf.zoomFit"), ctx);
  runAction(getAction("pdf.goToPage"), ctx);
  expect(c.zoomIn).toHaveBeenCalledTimes(1);
  expect(c.zoomOut).toHaveBeenCalledTimes(1);
  expect(c.zoomFit).toHaveBeenCalledTimes(1);
  expect(c.askGoToPage).toHaveBeenCalledTimes(1);
  off();
});

test("the_pdf_actions_are_off_for_a_text_document_and_for_a_pdf_that_is_not_mounted", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, controller());
  for (const id of ["pdf.zoomIn", "pdf.zoomOut", "pdf.zoomFit", "pdf.goToPage"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
  openPdf();
  for (const id of ["pdf.zoomIn", "pdf.zoomOut", "pdf.zoomFit", "pdf.goToPage"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
});

test("ctrl_plus_is_found_on_a_layout_where_plus_is_shifted_and_on_one_where_it_is_not", () => {
  const zoomIn = getAction("pdf.zoomIn").keys;
  const typed = (key: string, shiftKey: boolean) =>
    candidateKeys({ key, code: "", ctrlKey: true, altKey: false, shiftKey, metaKey: false });
  expect(zoomIn).toContain(typed("=", false)[0]);
  expect(zoomIn).toContain(typed("+", true)[0]);
  expect(zoomIn).toContain(typed("+", false)[0]);
  expect(getAction("pdf.zoomOut").keys).toContain(typed("-", false)[0]);
  expect(getAction("pdf.zoomFit").keys).toContain(typed("0", false)[0]);
  expect(getAction("pdf.goToPage").keys).toContain(typed("g", false)[0]);
});

test("the_pdf_keys_collide_with_no_other_action", () => {
  expect(findDuplicateBindings()).toEqual([]);
});

const LAYOUTS = [
  ["pdf.layout.scroll", "scroll"],
  ["pdf.layout.single", "single"],
  ["pdf.layout.spread", "spread"],
  ["pdf.layout.grid", "grid"],
] as const;

test("each_layout_action_stores_its_layout_for_every_pdf", () => {
  const id = openPdf();
  const off = registerPdf(id, controller());
  for (const [action, layout] of LAYOUTS) {
    vi.mocked(settingsSet).mockClear();
    runAction(getAction(action), currentContext());
    expect(settingsSet).toHaveBeenCalledWith({ pdf_layout: layout });
  }
  off();
});

test("the_layout_in_use_is_the_one_checked_in_the_menu", () => {
  for (const [action, layout] of LAYOUTS) {
    useViewSettings.setState({ pdfLayout: layout });
    const checked = LAYOUTS.filter(([a]) => getAction(a).checked?.()).map(([a]) => a);
    expect(checked).toEqual([action]);
  }
});

test("the_layout_actions_are_off_for_a_text_document_and_a_pdf_that_is_not_mounted", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, controller());
  for (const [id] of LAYOUTS) expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  openPdf();
  for (const [id] of LAYOUTS) expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
});

test("every_layout_has_a_label_a_view_menu_entry_and_a_shortcut_of_its_own", () => {
  const keys = LAYOUTS.map(([id]) => getAction(id).keys);
  for (const [id] of LAYOUTS) {
    expect(getAction(id).area).toBe("View");
    expect(getAction(id).label).not.toBe("");
    expect(getAction(id).keys.length).toBeGreaterThan(0);
  }
  expect(new Set(keys.flat()).size).toBe(keys.flat().length);
});

const placeOf = (id: "thumbnails" | "tools") => useViewSettings.getState().pdfPanels[id];

test("the_panel_toggle_actions_fold_and_open_each_panel_through_the_setting", async () => {
  const id = openPdf();
  const off = registerPdf(id, controller());
  vi.mocked(settingsSet).mockImplementation(async (patch) => ({
    ...SETTINGS,
    ...(patch as object),
  }));
  runAction(getAction("pdf.panel.thumbnails.toggle"), currentContext());
  await vi.waitFor(() => expect(placeOf("thumbnails").collapsed).toBe(true));
  expect(vi.mocked(settingsSet).mock.calls[0]?.[0]).toEqual({
    pdf_panels: {
      thumbnails: { side: "left", collapsed: true },
      tools: { side: "right", collapsed: false },
    },
  });
  expect(getAction("pdf.panel.thumbnails.toggle").menuLabel?.()).toBe("Expand Thumbnails");
  expect(getAction("pdf.panel.tools.toggle").menuLabel?.()).toBe("Collapse Tools");
  off();
});

test("the_panel_move_actions_are_off_on_the_side_the_panel_is_already_on", () => {
  const id = openPdf();
  const off = registerPdf(id, controller());
  const ctx = currentContext();
  expect(isEnabled(getAction("pdf.panel.thumbnails.move.left"), ctx)).toBe(false);
  expect(isEnabled(getAction("pdf.panel.thumbnails.move.right"), ctx)).toBe(true);
  expect(isEnabled(getAction("pdf.panel.thumbnails.move.bottom"), ctx)).toBe(true);
  expect(isEnabled(getAction("pdf.panel.tools.move.right"), ctx)).toBe(false);
  expect(isEnabled(getAction("pdf.panel.tools.move.left"), ctx)).toBe(true);
  off();
});

test("the_panel_actions_are_off_without_a_mounted_pdf_and_each_toggle_has_a_key", () => {
  openPdf();
  for (const a of [
    "pdf.panel.thumbnails.toggle",
    "pdf.panel.tools.toggle",
    "pdf.panel.tools.move.left",
  ]) {
    expect(isEnabled(getAction(a), currentContext()), a).toBe(false);
  }
  expect(getAction("pdf.panel.thumbnails.toggle").keys).toEqual(["Ctrl+Alt+5"]);
  expect(getAction("pdf.panel.tools.toggle").keys).toEqual(["Ctrl+Alt+6"]);
});

const ROTATIONS = [
  ["pdf.rotate.cw", 90, "page", ["Ctrl+R"]],
  ["pdf.rotate.ccw", 270, "page", ["Ctrl+Shift+R"]],
  ["pdf.rotateAll.cw", 90, "all", []],
  ["pdf.rotateAll.ccw", 270, "all", []],
] as const;

test("each_rotate_action_turns_the_pages_it_names_and_has_the_keys_it_should", () => {
  const id = openPdf();
  const c = controller();
  const off = registerPdf(id, c);
  for (const [action, degrees, scope, keys] of ROTATIONS) {
    vi.mocked(c.rotate).mockClear();
    runAction(getAction(action), currentContext());
    expect(c.rotate, action).toHaveBeenCalledExactlyOnceWith(degrees, scope);
    expect(getAction(action).keys, action).toEqual(keys);
    expect(getAction(action).area).toBe("Edit");
  }
  off();
});

test("undo_and_redo_run_on_the_viewer_and_take_the_editors_keys", () => {
  const id = openPdf();
  const c = controller();
  const off = registerPdf(id, c);
  runAction(getAction("pdf.undo"), currentContext());
  runAction(getAction("pdf.redo"), currentContext());
  expect(c.undo).toHaveBeenCalledTimes(1);
  expect(c.redo).toHaveBeenCalledTimes(1);
  expect(getAction("pdf.undo").keys).toEqual(["Ctrl+Z"]);
  expect(getAction("pdf.redo").keys).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
  off();
});

test("the_edit_actions_follow_what_the_viewer_says_can_be_done", () => {
  const id = openPdf();
  const off = registerPdf(
    id,
    testController({ canEdit: () => false, canUndo: () => false, canRedo: () => false })
  );
  for (const id of ["pdf.rotate.cw", "pdf.rotateAll.ccw", "pdf.undo", "pdf.redo"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
  off();
  const onlyUndo = registerPdf(id, testController({ canRedo: () => false }));
  expect(isEnabled(getAction("pdf.undo"), currentContext())).toBe(true);
  expect(isEnabled(getAction("pdf.redo"), currentContext())).toBe(false);
  expect(isEnabled(getAction("pdf.rotate.cw"), currentContext())).toBe(true);
  onlyUndo();
});

test("the_edit_actions_are_off_for_a_text_document_and_a_pdf_that_is_not_mounted", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, controller());
  const ids = ROTATIONS.map(([a]) => a as string).concat(["pdf.undo", "pdf.redo"]);
  for (const id of ids) expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  openPdf();
  for (const id of ids) expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
});

test("the_compacted_copy_and_reload_actions_run_on_the_viewer_and_follow_what_it_allows", () => {
  const id = openPdf();
  const askCompactedCopy = vi.fn();
  const askReload = vi.fn();
  let allowed = true;
  const off = registerPdf(
    id,
    testController({
      askCompactedCopy,
      askReload,
      canCompactedCopy: () => allowed,
      canReload: () => allowed,
    })
  );
  const ctx = currentContext();
  const compacted = getAction("pdf.saveCompacted");
  const reload = getAction("pdf.reload");
  expect(compacted.keys).toEqual([]);
  expect(reload.keys).toEqual([]);
  expect(compacted.label).toBe("Save a compacted copy…");
  expect(reload.label).toBe("Reload from disk");
  runAction(compacted, ctx);
  runAction(reload, ctx);
  expect(askCompactedCopy).toHaveBeenCalledTimes(1);
  expect(askReload).toHaveBeenCalledTimes(1);
  allowed = false;
  expect(isEnabled(compacted, ctx)).toBe(false);
  expect(isEnabled(reload, ctx)).toBe(false);
  off();
});

test("save_and_save_as_are_the_document_actions_a_pdf_shares_with_text", () => {
  // A PDF registers its commands under the same controller, so Ctrl+S and Ctrl+Shift+S reach it.
  expect(getAction("doc.save").keys).toEqual(["Ctrl+S"]);
  expect(getAction("doc.saveAs").keys).toEqual(["Ctrl+Shift+S"]);
});

test("copy_select_all_and_search_run_on_the_viewer_and_follow_the_selection", () => {
  const id = openPdf();
  const copySelection = vi.fn();
  const selectAll = vi.fn();
  const searchSelection = vi.fn();
  let selected = true;
  const off = registerPdf(
    id,
    testController({ copySelection, selectAll, searchSelection, hasSelection: () => selected })
  );
  const ctx = currentContext();
  const copy = getAction("pdf.copy");
  const all = getAction("pdf.selectAll");
  const search = getAction("pdf.searchSelection");
  expect(copy.keys).toEqual(["Ctrl+C"]);
  expect(all.keys).toEqual(["Ctrl+A"]);
  expect(search.keys).toEqual([]);
  runAction(copy, ctx);
  runAction(all, ctx);
  runAction(search, ctx);
  expect(copySelection).toHaveBeenCalledTimes(1);
  expect(selectAll).toHaveBeenCalledTimes(1);
  expect(searchSelection).toHaveBeenCalledTimes(1);
  // Copy and Search need a selection; Select all does not.
  selected = false;
  expect(isEnabled(copy, ctx)).toBe(false);
  expect(isEnabled(search, ctx)).toBe(false);
  expect(isEnabled(all, ctx)).toBe(true);
  off();
});

test("copy_and_select_all_do_not_reach_a_folder_or_a_text_document", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  for (const id of ["pdf.copy", "pdf.selectAll", "pdf.searchSelection"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
});

test("find_and_the_two_steps_run_on_the_viewer_with_their_keys", () => {
  const id = openPdf();
  const openFind = vi.fn();
  const findStep = vi.fn();
  let can = true;
  const off = registerPdf(id, testController({ openFind, findStep, canFind: () => can }));
  const ctx = currentContext();
  const find = getAction("pdf.find");
  const next = getAction("pdf.findNext");
  const previous = getAction("pdf.findPrevious");
  expect(find.keys).toEqual(["Ctrl+F"]);
  expect(next.keys).toEqual(["F3"]);
  expect(previous.keys).toEqual(["Shift+F3"]);
  runAction(find, ctx);
  runAction(next, ctx);
  runAction(previous, ctx);
  expect(openFind).toHaveBeenCalledTimes(1);
  expect(findStep.mock.calls).toEqual([[1], [-1]]);
  can = false;
  for (const a of [find, next, previous]) expect(isEnabled(a, ctx), a.id).toBe(false);
  off();
});

test("find_does_not_reach_a_folder_or_a_text_document", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  for (const id of ["pdf.find", "pdf.findNext", "pdf.findPrevious"]) {
    expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  }
});

test("the_actions_on_chosen_pages_run_on_the_viewer_and_follow_the_choice_and_the_edit_state", () => {
  const id = openPdf();
  const c = testController({ hasPageSelection: () => false });
  const off = registerPdf(id, c);
  const ctx = currentContext();
  for (const name of ["pdf.rotateSelection.cw", "pdf.rotateSelection.ccw", "pdf.page.remove"]) {
    expect(isEnabled(getAction(name), ctx), name).toBe(false);
  }
  off();
  const chosen = testController({ hasPageSelection: () => true });
  const on = registerPdf(id, chosen);
  runAction(getAction("pdf.rotateSelection.cw"), ctx);
  runAction(getAction("pdf.rotateSelection.ccw"), ctx);
  runAction(getAction("pdf.page.remove"), ctx);
  expect(chosen.rotate).toHaveBeenNthCalledWith(1, 90, "selection");
  expect(chosen.rotate).toHaveBeenNthCalledWith(2, 270, "selection");
  expect(chosen.removeSelection).toHaveBeenCalledTimes(1);
  on();
  // A document that cannot be changed here turns all three off even with pages chosen.
  const held = testController({ hasPageSelection: () => true, canEdit: () => false });
  const hold = registerPdf(id, held);
  for (const name of ["pdf.rotateSelection.cw", "pdf.rotateSelection.ccw", "pdf.page.remove"]) {
    expect(isEnabled(getAction(name), ctx), name).toBe(false);
  }
  hold();
});

test("merge_extract_and_split_run_on_the_viewer_and_have_menu_entries_and_no_keys", () => {
  const id = openPdf();
  const c = testController();
  const off = registerPdf(id, c);
  const ctx = currentContext();
  runAction(getAction("pdf.merge"), ctx);
  runAction(getAction("pdf.extract"), ctx);
  runAction(getAction("pdf.split"), ctx);
  expect(c.askMerge).toHaveBeenCalledTimes(1);
  expect(c.askExtract).toHaveBeenCalledTimes(1);
  expect(c.askSplit).toHaveBeenCalledTimes(1);
  for (const name of ["pdf.merge", "pdf.extract", "pdf.split"]) {
    expect(getAction(name).area, name).toBe("File");
    expect(getAction(name).keys, name).toEqual([]);
  }
  off();
  const closed = testController({ canPageFiles: () => false });
  const shut = registerPdf(id, closed);
  expect(isEnabled(getAction("pdf.merge"), ctx)).toBe(false);
  shut();
});

test("merge_extract_and_split_do_not_reach_a_text_document", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, testController());
  for (const name of ["pdf.merge", "pdf.extract", "pdf.split", "pdf.page.remove"]) {
    expect(isEnabled(getAction(name), currentContext()), name).toBe(false);
  }
});

test("the_annotation_tools_run_on_the_viewer_and_the_pen_and_note_follow_the_edit_state", () => {
  const id = openPdf();
  const c = testController();
  const off = registerPdf(id, c);
  const ctx = currentContext();
  runAction(getAction("pdf.tool.select"), ctx);
  runAction(getAction("pdf.tool.ink"), ctx);
  runAction(getAction("pdf.note.add"), ctx);
  expect(c.setTool).toHaveBeenNthCalledWith(1, "select");
  expect(c.setTool).toHaveBeenNthCalledWith(2, "ink");
  expect(c.setTool).toHaveBeenNthCalledWith(3, "note");
  off();
  const held = testController({ canAnnotate: () => false });
  const hold = registerPdf(id, held);
  expect(isEnabled(getAction("pdf.tool.ink"), ctx)).toBe(false);
  expect(isEnabled(getAction("pdf.note.add"), ctx)).toBe(false);
  // Select can always be chosen: it is how a tool is put down.
  expect(isEnabled(getAction("pdf.tool.select"), ctx)).toBe(true);
  hold();
});

test("the_markup_actions_act_on_the_selected_text_and_each_has_a_key", () => {
  const id = openPdf();
  const c = testController({ canMark: () => false });
  const off = registerPdf(id, c);
  const ctx = currentContext();
  for (const name of ["pdf.markup.highlight", "pdf.markup.underline", "pdf.markup.strikeout"]) {
    expect(isEnabled(getAction(name), ctx), name).toBe(false);
    expect(getAction(name).keys.length, name).toBe(1);
  }
  off();
  const ready = testController({ canMark: () => true });
  const on = registerPdf(id, ready);
  runAction(getAction("pdf.markup.highlight"), ctx);
  runAction(getAction("pdf.markup.underline"), ctx);
  runAction(getAction("pdf.markup.strikeout"), ctx);
  expect(vi.mocked(ready.mark).mock.calls).toEqual([["highlight"], ["underline"], ["strikeOut"]]);
  on();
});

test("delete_takes_the_picked_annotation_away_and_only_while_one_is_picked", () => {
  const id = openPdf();
  const none = testController({ hasPickedAnnotation: () => false });
  const off = registerPdf(id, none);
  const ctx = currentContext();
  const del = getAction("pdf.annotation.delete");
  expect(del.keys).toEqual(["Delete"]);
  expect(isEnabled(del, ctx)).toBe(false);
  off();
  const some = testController({ hasPickedAnnotation: () => true });
  const on = registerPdf(id, some);
  runAction(del, ctx);
  expect(some.deletePicked).toHaveBeenCalledTimes(1);
  on();
});

test("the_annotation_actions_do_not_reach_a_text_document", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const textId = useTabs.getState().activeId as string;
  registerPdf(textId, testController());
  for (const name of [
    "pdf.tool.select",
    "pdf.tool.ink",
    "pdf.note.add",
    "pdf.markup.highlight",
    "pdf.annotation.delete",
  ]) {
    expect(isEnabled(getAction(name), currentContext()), name).toBe(false);
  }
});
