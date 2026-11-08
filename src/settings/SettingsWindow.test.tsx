// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Queued, Settings } from "../ipc";
import { SETTINGS } from "./test-settings";

// The Settings window as the app mounts it (App in a window labelled "settings"), with the one
// place a command leaves the page (Tauri's invoke) answering as the backend would and recording
// every command sent. Word wrap stands in for a setting that applies only at start, so Restart
// Kern can be offered; every setting Kern has applies at once (restart-fields.ts).

const wire = vi.hoisted(() => ({
  sent: [] as { cmd: string; args: Record<string, unknown> }[],
  handlers: {} as Record<string, (payload: unknown) => void>,
  answer: (_cmd: string, _args: Record<string, unknown>): unknown => null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    wire.sent.push({ cmd, args: args ?? {} });
    try {
      return Promise.resolve(wire.answer(cmd, args ?? {}));
    } catch (e) {
      return Promise.reject(e);
    }
  },
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, h: (e: { payload: unknown }) => void) => {
    wire.handlers[name] = (payload: unknown) => h({ payload });
    return Promise.resolve(() => undefined);
  },
}));
vi.mock("./restart-fields", () => ({ NEEDS_RESTART: ["word_wrap"] }));

import App from "../App";
import { useOps } from "../ops/useOps";
import { useCloseGuard } from "../shell/useCloseGuard";
import { useUserDirs } from "../shell/user-dirs-store";
import { useStoreErrors } from "../store/store-errors";
import { useSettingsDraft } from "./settings-draft";
import { useSettingsNav } from "./settings-nav";

const KERNKRAFT = "plugin:kernkraft-tauri|";

let stored: Settings;
let queued: Queued[];
/** The next settings_set fails with this, once. */
let failSet: unknown = null;

function answer(cmd: string, args: Record<string, unknown>): unknown {
  const name = cmd.startsWith(KERNKRAFT) ? cmd.slice(KERNKRAFT.length) : cmd;
  switch (name) {
    case "open_pending_take":
      return queued.splice(0);
    case "settings_get":
      return stored;
    case "settings_set": {
      if (failSet) {
        const e = failSet;
        failSet = null;
        throw e;
      }
      const patch = args.patch as Partial<Settings>;
      stored = { ...stored, ...patch, follow: { ...stored.follow, ...patch.follow } };
      return stored;
    }
    case "theme_get":
      return { css: ":root{}", tokens: { scheme: "light" }, fallbacks: [], problems: [] };
    case "user_dirs":
      return { home: { k: "Utf8", v: "/home/a" }, dirs: [] };
    case "default_fm_status":
      return { is_default: false, current: "dolphin.desktop" };
    case "make_default_fm":
      return { is_default: true, current: "io.github.verycareful.kern.desktop" };
    case "fm1_status":
      return { owned: true, owner: null, reason: null };
    case "store_errors_take":
      return [];
    default:
      // theme_set_prefs, open_url, confirm_close, restart_request, restart_abandon.
      return null;
  }
}

const sent = (cmd: string) => wire.sent.filter((s) => s.cmd === cmd);

beforeEach(() => {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "settings" } },
  };
  stored = { ...SETTINGS, follow: { ...SETTINGS.follow } };
  queued = [];
  failSet = null;
  wire.sent = [];
  wire.handlers = {};
  wire.answer = answer;
  useSettingsDraft.getState().reset();
  useSettingsNav.setState({ section: null });
  useStoreErrors.setState({ reports: [], error: null });
  useCloseGuard.getState().reset();
  useUserDirs.getState().reset();
  useOps.setState({ notice: null, earlier: [] });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function mount() {
  render(<App />);
  await screen.findByRole("heading", { name: "Appearance", level: 1 });
}

const nav = (name: string) =>
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name }));
const save = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
const pressed = (group: string, name: string) =>
  within(screen.getByRole("group", { name: group })).getByRole("button", { name });

function grantedToSettings(): Set<string> {
  const file = resolve(process.cwd(), "src-tauri/capabilities/settings.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    windows: string[];
    permissions: string[];
  };
  expect(json.windows).toEqual(["settings"]);
  return new Set(json.permissions);
}

function permissionOf(cmd: string): string | null {
  const dashed = (name: string) => name.replace(/_/g, "-");
  if (cmd.startsWith(KERNKRAFT))
    return `kernkraft-tauri:allow-${dashed(cmd.slice(KERNKRAFT.length))}`;
  // Events are the core's, granted by core:default.
  if (cmd.startsWith("plugin:")) return null;
  return `allow-${dashed(cmd)}`;
}

test("every_command_the_settings_window_sends_is_granted_to_it", async () => {
  await mount();
  // Appearance, saved: the settings and the theme.
  fireEvent.click(pressed("Theme", "Dark"));
  await save();
  // Files: the default file manager is made at once.
  nav("Files");
  // Enabled once the current default has been looked up.
  const make = await screen.findByRole("button", { name: "Make Kern the default file manager" });
  await waitFor(() => expect(make).toBeEnabled());
  fireEvent.click(make);
  await waitFor(() => expect(sent("make_default_fm")).toHaveLength(1));
  // Library: a folder typed with ~ asks for Home.
  nav("Library");
  fireEvent.change(screen.getByLabelText("Add a folder"), { target: { value: "~/Projects" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText("/home/a/Projects");
  // About: a link opens in the browser.
  nav("About");
  fireEvent.click(screen.getByRole("button", { name: "Source code" }));
  fireEvent.click(screen.getByRole("button", { name: "Kern for Android" }));
  // Editor: a change that needs a restart, saved, then Restart Kern.
  nav("Editor");
  fireEvent.click(screen.getByRole("switch", { name: "Wrap long lines" }));
  await save();
  fireEvent.click(await screen.findByRole("button", { name: "Restart Kern" }));
  // Closed with nothing to lose, and a restart that a window called off.
  await act(async () => wire.handlers["kern://close-requested"]?.({ restart: true }));
  await waitFor(() => expect(sent("confirm_close")).toHaveLength(1));
  await act(async () => {
    useSettingsDraft.getState().edit({ show_hidden: true });
    wire.handlers["kern://close-requested"]?.({ restart: true });
  });
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(sent("restart_abandon")).toHaveLength(1));

  const seen = new Set(wire.sent.map((s) => s.cmd));
  for (const must of [
    "settings_get",
    "settings_set",
    `${KERNKRAFT}theme_set_prefs`,
    `${KERNKRAFT}user_dirs`,
    `${KERNKRAFT}open_url`,
    "make_default_fm",
    "restart_request",
    "restart_abandon",
    "confirm_close",
    "open_pending_take",
  ]) {
    expect(seen, must).toContain(must);
  }
  const granted = grantedToSettings();
  const refused = [...seen].filter((c) => {
    const perm = permissionOf(c);
    return perm !== null && !granted.has(perm);
  });
  expect(refused).toEqual([]);
});

test("a_change_shows_at_once_and_is_stored_only_by_save_with_just_what_changed", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  fireEvent.click(pressed("Interface size", "125 %"));
  expect(pressed("Theme", "Dark")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("settings-status")).toHaveTextContent("Changes not saved yet.");
  expect(sent("settings_set")).toHaveLength(0);
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([
    { theme_mode: "dark", interface_size: 125 },
  ]);
  // The theme is handed the stored choice, with Kern's one row density.
  expect(sent(`${KERNKRAFT}theme_set_prefs`).map((s) => s.args)).toEqual([
    { follow: SETTINGS.follow, user: { mode: "dark", accent: "slate", density: "cozy" } },
  ]);
  expect(screen.getByTestId("settings-status")).toHaveTextContent(
    "Changes apply when you press Save."
  );
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("the_main_window_layout_offers_the_file_manager_and_greys_the_editor", async () => {
  await mount();
  nav("Files");
  expect(pressed("Main window layout", "File manager")).toHaveAttribute("aria-pressed", "true");
  const editor = pressed("Main window layout", "Editor");
  expect(editor).toBeDisabled();
  fireEvent.click(editor);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByText(/not available for the main window yet/)).toBeInTheDocument();
});

test("a_save_without_a_theme_field_leaves_the_theme_alone", async () => {
  await mount();
  nav("Files");
  fireEvent.click(screen.getByRole("switch", { name: "Show hidden items" }));
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([{ show_hidden: true }]);
  expect(sent(`${KERNKRAFT}theme_set_prefs`)).toHaveLength(0);
});

test("revert_drops_the_changes_and_a_change_undone_by_hand_is_no_change", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  fireEvent.click(pressed("Theme", "System"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.click(pressed("Theme", "Light"));
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));
  expect(pressed("Theme", "System")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a_change_made_elsewhere_shows_in_what_was_not_changed_here", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  act(() =>
    wire.handlers["kern://settings-changed"]?.({
      ...stored,
      interface_size: 80,
      theme_mode: "light",
    })
  );
  // The interface size follows the store; the theme keeps the change made here.
  expect(pressed("Interface size", "80 %")).toHaveAttribute("aria-pressed", "true");
  expect(pressed("Theme", "Dark")).toHaveAttribute("aria-pressed", "true");
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([{ theme_mode: "dark" }]);
});

test("a_save_that_fails_keeps_the_changes_and_says_why", async () => {
  await mount();
  failSet = { kind: "Io", message: "disk full", path: null, details: null };
  fireEvent.click(pressed("Theme", "Dark"));
  await save();
  expect(screen.getByTestId("settings-problem")).toHaveTextContent(
    /The settings were not saved: .*disk full/
  );
  expect(pressed("Theme", "Dark")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await save();
  expect(screen.queryByTestId("settings-problem")).not.toBeInTheDocument();
});

test("ctrl_s_saves", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  await act(async () =>
    fireEvent.keyDown(screen.getByTestId("settings-window"), { key: "s", ctrlKey: true })
  );
  expect(sent("settings_set")).toHaveLength(1);
});

test("closing_with_changes_not_saved_asks_and_cancel_keeps_the_window", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  await act(async () => wire.handlers["kern://close-requested"]?.(null));
  const prompt = await screen.findByTestId("settings-close-prompt");
  fireEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByTestId("settings-close-prompt")).toBeNull());
  expect(sent("confirm_close")).toHaveLength(0);
  expect(pressed("Theme", "Dark")).toHaveAttribute("aria-pressed", "true");
  // A plain close calls no restart off.
  expect(sent("restart_abandon")).toHaveLength(0);
});

test("closing_without_saving_drops_the_changes_and_closes", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  await act(async () => wire.handlers["kern://close-requested"]?.(null));
  fireEvent.click(await screen.findByRole("button", { name: "Close without saving" }));
  await waitFor(() => expect(sent("confirm_close")).toHaveLength(1));
  expect(sent("settings_set")).toHaveLength(0);
});

test("save_in_the_close_question_saves_then_closes_and_a_failed_save_keeps_the_window", async () => {
  await mount();
  fireEvent.click(pressed("Theme", "Dark"));
  failSet = { kind: "Io", message: "disk full", path: null, details: null };
  await act(async () => wire.handlers["kern://close-requested"]?.(null));
  await act(async () =>
    fireEvent.click(
      within(await screen.findByTestId("settings-close-prompt")).getByRole("button", {
        name: "Save",
      })
    )
  );
  expect(sent("confirm_close")).toHaveLength(0);
  expect(screen.getByTestId("settings-problem")).toHaveTextContent("disk full");
  await act(async () => wire.handlers["kern://close-requested"]?.(null));
  await act(async () =>
    fireEvent.click(
      within(await screen.findByTestId("settings-close-prompt")).getByRole("button", {
        name: "Save",
      })
    )
  );
  await waitFor(() => expect(sent("confirm_close")).toHaveLength(1));
  expect(stored.theme_mode).toBe("dark");
});

test("restart_is_offered_only_once_a_change_that_needs_it_is_saved", async () => {
  await mount();
  nav("Files");
  fireEvent.click(screen.getByRole("switch", { name: "Show hidden items" }));
  await save();
  expect(screen.queryByRole("button", { name: "Restart Kern" })).not.toBeInTheDocument();
  nav("Editor");
  fireEvent.click(screen.getByRole("switch", { name: "Wrap long lines" }));
  expect(screen.queryByRole("button", { name: "Restart Kern" })).not.toBeInTheDocument();
  await save();
  expect(screen.getByTestId("settings-status")).toHaveTextContent(
    "Saved. Kern applies some of it when it starts again."
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart Kern" })));
  expect(sent("restart_request")).toHaveLength(1);
});

test("a_restart_that_cannot_be_asked_says_why", async () => {
  await mount();
  nav("Editor");
  fireEvent.click(screen.getByRole("switch", { name: "Wrap long lines" }));
  await save();
  wire.answer = (cmd, args) => {
    if (cmd === "restart_request") {
      throw {
        kind: "Window",
        message: "it could not ask main to close",
        path: null,
        details: null,
      };
    }
    return answer(cmd, args);
  };
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart Kern" })));
  expect(await screen.findByText(/it could not ask main to close/)).toBeInTheDocument();
});

test("search_shows_every_row_it_finds_under_its_category", async () => {
  await mount();
  const search = screen.getByRole("searchbox", { name: "Search settings" });
  fireEvent.change(search, { target: { value: "accent" } });
  // Two rows of Appearance, nothing else.
  expect(screen.getByRole("heading", { name: "Appearance", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Accent colour" })).toBeInTheDocument();
  expect(
    screen.getByRole("switch", { name: "Follow the system: accent colour" })
  ).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Theme" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Files" })).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: "HIDDEN dot" } });
  expect(screen.getByRole("heading", { name: "Files", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Show hidden items" })).toBeInTheDocument();

  fireEvent.change(search, { target: { value: "nothing like it" } });
  expect(screen.getByText("No setting matches “nothing like it”.")).toBeInTheDocument();

  // A category picked clears the search.
  nav("About");
  expect(search).toHaveValue("");
  expect(screen.getByRole("heading", { name: "About", level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Nothing leaves this computer")).toBeInTheDocument();
});

test("the_window_opens_at_the_category_it_was_asked_for", async () => {
  queued = [{ event: "kern://open", payload: { kind: "settings_section", section: "about" } }];
  render(<App />);
  const about = await screen.findByRole("heading", { name: "About", level: 1 });
  await waitFor(() => expect(about).toHaveFocus());
  expect(screen.getByTestId("about-version")).toBeInTheDocument();
  expect(useSettingsNav.getState().section).toBeNull();
  // Asked again while open, for a category it does not have: it says so and stays.
  act(() => wire.handlers["kern://open"]?.({ kind: "settings_section", section: "plugins" }));
  expect(
    await screen.findByText(/category “plugins”, which this version does not have/)
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "About", level: 1 })).toBeInTheDocument();
});

test("the_logo_in_the_sidebar_shows_about", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "About Kern" }));
  expect(await screen.findByRole("heading", { name: "About", level: 1 })).toBeInTheDocument();
});

test("a_followed_accent_disables_the_swatches_until_the_switch_is_off", async () => {
  await mount();
  expect(
    within(screen.getByRole("group", { name: "Accent colour" })).getByRole("button", {
      name: "Indigo",
    })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "Follow the system: accent colour" }));
  const indigo = within(screen.getByRole("group", { name: "Accent colour" })).getByRole("button", {
    name: "Indigo",
  });
  expect(indigo).toBeEnabled();
  fireEvent.click(indigo);
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([
    { follow: { accent: false }, accent: "indigo" },
  ]);
});

test("a_library_folder_already_listed_is_refused_and_one_removed_is_saved_away", async () => {
  stored = { ...stored, scan_roots: [{ k: "Utf8", v: "/home/a/Projects" }] };
  await mount();
  nav("Library");
  fireEvent.change(screen.getByLabelText("Add a folder"), { target: { value: "~/Projects" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("is already in the list");
  fireEvent.click(screen.getByRole("button", { name: /^Remove / }));
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([{ scan_roots: [] }]);
});

test("the_editor_text_size_steps_by_a_quarter_and_stops_at_the_ends", async () => {
  stored = { ...stored, editor_zoom: 4.75 };
  await mount();
  nav("Editor");
  fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
  expect(screen.getByLabelText("Text size")).toHaveTextContent("500%");
  expect(screen.getByRole("button", { name: "Larger text" })).toBeDisabled();
});

test("about_shows_the_licence_in_a_dialog_and_each_link_opens_its_address", async () => {
  await mount();
  nav("About");
  const source = screen.getByRole("button", { name: "Source code" });
  expect(source).toHaveAccessibleDescription("github.com/verycareful/kern-desktop");
  fireEvent.click(screen.getByRole("button", { name: "kernkraft" }));
  fireEvent.click(source);
  fireEvent.click(screen.getByRole("button", { name: "Kern for Android" }));
  await waitFor(() => expect(sent(`${KERNKRAFT}open_url`)).toHaveLength(3));
  expect(sent(`${KERNKRAFT}open_url`).map((s) => s.args.url)).toEqual([
    "https://github.com/verycareful/kernkraft",
    "https://github.com/verycareful/kern-desktop",
    "https://github.com/verycareful/kern",
  ]);
  expect(screen.queryByTestId("licence-dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Licence" }));
  const dialog = await screen.findByTestId("licence-dialog");
  expect(within(dialog).getByTestId("licence-text")).toHaveTextContent(
    "GNU AFFERO GENERAL PUBLIC LICENSE"
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByTestId("licence-dialog")).not.toBeInTheDocument();
});

test("the_error_log_switch_is_on_by_default_says_where_the_file_is_and_is_saved_at_save", async () => {
  await mount();
  nav("About");
  const toggle = screen.getByRole("switch", { name: "Write an error log" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText(/kern\.log in \$XDG_STATE_HOME\/kern/)).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([{ error_log: false }]);
  expect(stored.error_log).toBe(false);
});

test("the_error_log_switch_is_found_by_searching_for_a_crash_log", async () => {
  await mount();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "crash" } });
  expect(screen.getByRole("switch", { name: "Write an error log" })).toBeInTheDocument();
});

test("a_link_that_cannot_be_opened_says_why", async () => {
  await mount();
  nav("About");
  wire.answer = (cmd, args) => {
    if (cmd === `${KERNKRAFT}open_url`) {
      throw { kind: "NoApp", message: "no browser", path: null, details: null };
    }
    return answer(cmd, args);
  };
  fireEvent.click(screen.getByRole("button", { name: "Source code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /github.com\/verycareful\/kern-desktop could not be opened: .*no browser/
  );
});

test("the_new_tab_folder_is_home_or_a_folder_typed_as_a_path", async () => {
  await mount();
  nav("Files");
  expect(pressed("New tab folder", "Home")).toHaveAttribute("aria-pressed", "true");
  // Another folder changes nothing until a path is taken.
  fireEvent.click(pressed("New tab folder", "Another folder"));
  const field = screen.getByLabelText("Folder for new tabs");
  fireEvent.change(field, { target: { value: "projects" } });
  fireEvent.blur(field);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "~/Projects" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([
    { new_tab_folder: { k: "Utf8", v: "/home/a/Projects" } },
  ]);
  // Home again stores none.
  fireEvent.click(pressed("New tab folder", "Home"));
  expect(screen.queryByLabelText("Folder for new tabs")).toBeNull();
  await save();
  expect(sent("settings_set")[1]!.args.patch).toEqual({ new_tab_folder: null });
});

test("a_stored_new_tab_folder_shows_as_another_folder_with_its_path", async () => {
  stored = { ...stored, new_tab_folder: { k: "Utf8", v: "/srv/work" } };
  await mount();
  nav("Files");
  expect(pressed("New tab folder", "Another folder")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Folder for new tabs")).toHaveValue("/srv/work");
});

test("ctrl_t_opens_the_new_tab_folder_or_the_current_folder", async () => {
  await mount();
  nav("Files");
  expect(pressed("Ctrl+T opens", "New tab folder")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(pressed("Ctrl+T opens", "Current folder"));
  await save();
  expect(sent("settings_set").map((s) => s.args.patch)).toEqual([{ new_tab_default: "current" }]);
});
