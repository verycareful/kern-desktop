// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(cleanup);

/**
 * Sends a keydown and says whether anything called preventDefault on it and whether a
 * listener on the window, where the shortcuts are, still got it.
 */
function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  let reached = false;
  const probe = () => (reached = true);
  window.addEventListener("keydown", probe);
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  window.removeEventListener("keydown", probe);
  return { held: event.defaultPrevented, reached };
}

test("a_key_aimed_at_the_page_behind_is_held_back_and_escape_closes", () => {
  const onEscape = vi.fn();
  render(
    <Modal role="dialog" label="One" onEscape={onEscape}>
      <button>Inside</button>
    </Modal>
  );
  const behind = document.body.appendChild(document.createElement("button"));
  expect(press(behind, "Delete")).toEqual({ held: true, reached: false });
  expect(onEscape).not.toHaveBeenCalled();
  press(behind, "Escape");
  expect(onEscape).toHaveBeenCalledTimes(1);
  behind.remove();
});

test("keys_typed_inside_do_not_reach_the_window_shortcuts", () => {
  render(
    <Modal role="dialog" label="One">
      <button>Inside</button>
    </Modal>
  );
  // The key is the dialog's own (not prevented), and the window's shortcuts never see it.
  expect(press(screen.getByRole("button", { name: "Inside" }), "Delete")).toEqual({
    held: false,
    reached: false,
  });
});

test("the_first_control_has_the_focus_and_the_opener_gets_it_back", () => {
  const opener = document.body.appendChild(document.createElement("button"));
  opener.focus();
  const view = render(
    <Modal role="dialog" label="One">
      <button>First</button>
      <button>Last</button>
    </Modal>
  );
  expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

test("tab_and_shift_tab_wrap_inside_the_dialog", () => {
  render(
    <Modal role="dialog" label="One">
      <button>First</button>
      <button>Last</button>
    </Modal>
  );
  const first = screen.getByRole("button", { name: "First" });
  const last = screen.getByRole("button", { name: "Last" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
});

test("with_two_dialogs_open_the_one_opened_last_holds_the_keyboard", () => {
  const lowerEscape = vi.fn();
  const upperEscape = vi.fn();
  render(
    <>
      <Modal role="alertdialog" label="Lower" onEscape={lowerEscape}>
        <button>Lower button</button>
      </Modal>
      <Modal role="dialog" label="Upper" onEscape={upperEscape}>
        <button>Upper button</button>
      </Modal>
    </>
  );
  // A key aimed at the upper dialog's button is its own; one aimed at the lower dialog is held back.
  expect(press(screen.getByRole("button", { name: "Upper button" }), "Enter")).toEqual({
    held: false,
    reached: false,
  });
  expect(press(screen.getByRole("button", { name: "Lower button" }), "Enter")).toEqual({
    held: true,
    reached: false,
  });
  // Escape aimed at the page goes to the upper dialog only.
  press(document.body, "Escape");
  expect(upperEscape).toHaveBeenCalledTimes(1);
  expect(lowerEscape).not.toHaveBeenCalled();
});

test("when_the_upper_dialog_closes_the_lower_one_holds_the_keyboard_again", () => {
  const lowerEscape = vi.fn();
  function Both(props: { upper: boolean }) {
    return (
      <>
        <Modal role="alertdialog" label="Lower" onEscape={lowerEscape}>
          <button>Lower button</button>
        </Modal>
        {props.upper && (
          <Modal role="dialog" label="Upper">
            <button>Upper button</button>
          </Modal>
        )}
      </>
    );
  }
  const view = render(<Both upper />);
  view.rerender(<Both upper={false} />);
  press(document.body, "Escape");
  expect(lowerEscape).toHaveBeenCalledTimes(1);
});
