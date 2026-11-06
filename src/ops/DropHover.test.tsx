// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DragOver, DropPayload, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({ on: vi.fn(), dndTarget: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useTabs } from "../store/tabs";
import { DROP_AREA_ATTR, dropTargetValue } from "./dnd";
import { DropHover } from "./DropHover";
import { useOps } from "./useOps";

// What the page does while a drag from another application passes over it: the place
// under the pointer lights up, the backend is told what it is, and a place that takes nothing says
// why. The events are those src-tauri/src/dnd.rs sends.

const p = (v: string): WirePath => ({ k: "Utf8", v });
let handlers: Record<string, Array<(payload: never) => void>>;
const emit = (name: string, payload: unknown) =>
  act(() => handlers[name]!.forEach((h) => h(payload as never)));

const over = (at: Partial<DragOver> = {}): DragOver => ({
  drag: 1,
  position: { x: 10, y: 10 },
  view: { width: window.innerWidth, height: window.innerHeight },
  ...at,
});

/** The element the pointer is over, by id. */
let under: string | null;
function setUp(html: string) {
  document.body.innerHTML = `<div id="host"></div>${html}`;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => (under ? document.getElementById(under) : null),
  });
}
const FOLDER = `
  <div id="body" ${DROP_AREA_ATTR}='${dropTargetValue(p("/d"))}'>
    <div id="sub" data-drop-target='${dropTargetValue(p("/d/sub"))}'>sub</div>
    <div id="other" data-drop-target='${dropTargetValue(p("/d/other"))}'>other</div>
    <div id="file">a.txt</div>
  </div>
  <div id="toolbar">toolbar</div>`;

beforeEach(() => {
  handlers = {};
  for (const m of Object.values(ipc)) m.mockReset();
  ipc.on.mockImplementation((name: string, h: (payload: never) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => undefined);
  });
  ipc.dndTarget.mockResolvedValue(undefined);
  useOps.getState().reset();
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p("/d"), false);
  under = null;
});
afterEach(() => {
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  document.body.innerHTML = "";
});

async function mount(html = FOLDER) {
  setUp(html);
  render(<DropHover />, { container: document.getElementById("host")! });
  await vi.waitFor(() => expect(handlers["kern://drag-over"]).toBeDefined());
  await vi.waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
}
const el = (id: string) => document.getElementById(id)!;

test("the_folder_row_under_the_pointer_lights_up_and_the_backend_is_told_its_folder", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  expect(el("sub")).toHaveClass("kern-drop-over");
  expect(ipc.dndTarget).toHaveBeenCalledExactlyOnceWith(1, {
    state: "folder",
    path: p("/d/sub"),
  });
  expect(screen.queryByRole("status")).toBeNull();
});

test("the_body_of_the_folder_view_lights_up_when_no_row_is_under_the_pointer", async () => {
  await mount();
  under = "file";
  emit("kern://drag-over", over());
  expect(el("body")).toHaveClass("kern-drop-over");
  expect(el("sub")).not.toHaveClass("kern-drop-over");
  expect(ipc.dndTarget).toHaveBeenCalledWith(1, { state: "folder", path: p("/d") });
});

test("a_place_that_takes_no_files_lights_nothing_and_says_why", async () => {
  await mount();
  under = "toolbar";
  emit("kern://drag-over", over());
  expect(document.querySelector(".kern-drop-over")).toBeNull();
  const reason = screen.getByRole("status").textContent!;
  expect(reason).toMatch(/folder/);
  expect(ipc.dndTarget).toHaveBeenCalledExactlyOnceWith(1, { state: "refused", reason });
});

test("a_point_that_cannot_be_resolved_is_refused_and_not_sent_to_the_folder_shown", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over({ view: { width: 0, height: 0 } }));
  expect(document.querySelector(".kern-drop-over")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(/could not tell where/);
  expect(ipc.dndTarget).toHaveBeenCalledWith(1, {
    state: "refused",
    reason: expect.stringMatching(/could not tell where/),
  });
});

test("moving_to_another_row_moves_the_highlight_and_the_answer_is_sent_only_when_it_changes", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  emit("kern://drag-over", over({ position: { x: 11, y: 11 } }));
  expect(ipc.dndTarget).toHaveBeenCalledTimes(1);
  under = "other";
  emit("kern://drag-over", over());
  expect(el("sub")).not.toHaveClass("kern-drop-over");
  expect(el("other")).toHaveClass("kern-drop-over");
  expect(ipc.dndTarget).toHaveBeenCalledTimes(2);
  expect(ipc.dndTarget).toHaveBeenLastCalledWith(1, { state: "folder", path: p("/d/other") });
});

test("leaving_clears_the_highlight_and_the_hint_and_coming_back_is_answered_again", async () => {
  await mount();
  under = "toolbar";
  emit("kern://drag-over", over());
  under = "sub";
  emit("kern://drag-over", over());
  expect(el("sub")).toHaveClass("kern-drop-over");
  emit("kern://drag-leave", { drag: 1 });
  expect(document.querySelector(".kern-drop-over")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  emit("kern://drag-over", over());
  expect(el("sub")).toHaveClass("kern-drop-over");
  expect(ipc.dndTarget).toHaveBeenCalledTimes(3);
});

test("a_folder_that_is_among_the_dragged_files_is_not_a_place_to_drop_them", async () => {
  await mount();
  emit("kern://drag-files", { drag: 1, paths: [p("/d/sub")] });
  under = "sub";
  emit("kern://drag-over", over());
  expect(el("sub")).not.toHaveClass("kern-drop-over");
  expect(screen.getByRole("status")).toHaveTextContent(/into itself/);
  expect(ipc.dndTarget).toHaveBeenCalledWith(1, {
    state: "refused",
    reason: expect.stringMatching(/into itself/),
  });
});

test("the_backends_reason_for_declining_is_shown_while_the_place_is_fine", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  emit("kern://drag-refusal", { drag: 1, refusal: "it names no files" });
  expect(screen.getByRole("status")).toHaveTextContent("It names no files.");
  emit("kern://drag-refusal", { drag: 1, refusal: null });
  expect(screen.queryByRole("status")).toBeNull();
});

test("a_reason_about_another_drag_is_ignored", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over({ drag: 2 }));
  emit("kern://drag-refusal", { drag: 1, refusal: "old" });
  expect(screen.queryByRole("status")).toBeNull();
});

test("a_new_drag_forgets_the_files_and_places_of_the_last", async () => {
  await mount();
  emit("kern://drag-files", { drag: 1, paths: [p("/d/sub")] });
  under = "sub";
  emit("kern://drag-over", over({ drag: 2 }));
  expect(el("sub")).toHaveClass("kern-drop-over");
  expect(ipc.dndTarget).toHaveBeenCalledWith(2, { state: "folder", path: p("/d/sub") });
});

test("a_pointer_over_a_tab_that_is_not_a_folder_is_refused", async () => {
  await mount();
  useTabs.getState().openTrash();
  under = "sub";
  emit("kern://drag-over", over());
  expect(document.querySelector(".kern-drop-over")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(/only be dropped on a folder tab/);
});

test("a_declined_drop_is_said_in_a_notice_and_clears_the_highlight", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  emit("kern://drop-refused", { drag: 1, reason: "it names no files" });
  expect(useOps.getState().notice?.text).toBe("It names no files.");
  expect(document.querySelector(".kern-drop-over")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

const dropOf = (at: Partial<DropPayload> = {}): DropPayload => ({
  paths: [p("/x/f")],
  position: { x: 10, y: 10 },
  view: { width: window.innerWidth, height: window.innerHeight },
  offered: ["copy", "move"],
  modifier: null,
  drag: 1,
  ...at,
});

test("a_drop_on_a_place_that_takes_nothing_says_why_and_is_not_left_to_any_view", async () => {
  await mount();
  under = "toolbar";
  emit("kern://drop", dropOf());
  expect(useOps.getState().notice?.text).toMatch(/Places/);
});

test("a_drop_whose_point_cannot_be_resolved_says_so", async () => {
  await mount();
  under = "sub";
  emit("kern://drop", dropOf({ view: { width: 0, height: 0 } }));
  expect(useOps.getState().notice?.text).toMatch(/could not tell where/);
});

test("a_drop_on_a_tab_that_is_not_a_folder_says_there_is_nowhere_to_put_it", async () => {
  await mount();
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openTrash();
  under = "sub";
  emit("kern://drop", dropOf());
  expect(useOps.getState().notice?.text).toMatch(/only be dropped on a folder tab/);
});

test("a_drop_on_a_folder_is_left_to_the_view_and_clears_the_highlight", async () => {
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  emit("kern://drop", dropOf());
  expect(useOps.getState().notice).toBeNull();
  expect(document.querySelector(".kern-drop-over")).toBeNull();
});

test("a_drop_into_one_of_the_dropped_folders_is_refused_with_the_reason", async () => {
  await mount();
  under = "sub";
  emit("kern://drop", dropOf({ paths: [p("/d/sub")] }));
  expect(useOps.getState().notice?.text).toMatch(/into itself/);
});

test("an_answer_the_backend_could_not_take_is_reported", async () => {
  ipc.dndTarget.mockRejectedValue({ kind: "Window", message: "the main thread is gone" });
  await mount();
  under = "sub";
  emit("kern://drag-over", over());
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  expect(useOps.getState().reports[0]!.outcome.error?.message).toMatch(/main thread/);
});
