// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  themeSetPrefs: vi.fn(),
  storeErrorsTake: vi.fn(),
  defaultFmStatus: vi.fn(),
  fm1Status: vi.fn(),
  makeDefaultFm: vi.fn(),
  openUrl: vi.fn(),
  userDirs: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useStoreErrors } from "../store/store-errors";
import { useUserDirs } from "../shell/user-dirs-store";
import { useThemeState } from "../theme/theme-state";
import { useSettings } from "./settings-store";
import { SettingsView } from "./SettingsView";
import { SETTINGS } from "./test-settings";

const p = (v: string): WirePath => ({ k: "Utf8", v });

let handlers: Record<string, (payload: unknown) => void>;
let stored: Settings;

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  stored = structuredClone(SETTINGS);
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.settingsGet.mockImplementation(() => Promise.resolve(stored));
  // settings_set answers with the settings as stored, a follow patch merged.
  ipc.settingsSet.mockImplementation((patch: Partial<Settings> & { follow?: object }) => {
    stored = { ...stored, ...patch, follow: { ...stored.follow, ...patch.follow } };
    return Promise.resolve(stored);
  });
  ipc.themeSetPrefs.mockResolvedValue({});
  ipc.storeErrorsTake.mockResolvedValue([]);
  ipc.defaultFmStatus.mockResolvedValue({ is_default: false, current: "org.kde.dolphin.desktop" });
  ipc.fm1Status.mockResolvedValue({ owned: true, owner: null, reason: null });
  ipc.openUrl.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [] });
  useSettings.getState().reset();
  useStoreErrors.getState().reset();
  useUserDirs.getState().reset();
  useThemeState.setState({ theme: null, error: null, problems: [] });
});
afterEach(() => cleanup());

async function shown() {
  render(<SettingsView />);
  await screen.findByRole("heading", { name: "Appearance" });
}

const fieldset = (legend: string) =>
  screen.getByRole("group", { name: legend }) as HTMLFieldSetElement;

test("follow_switch_off_uses_pick", async () => {
  await shown();
  // Following the system accent, the pick is not used, and says why.
  expect(fieldset("Accent")).toBeDisabled();
  expect(fieldset("Accent")).toHaveTextContent(/Kern follows your system's accent colour/);

  fireEvent.click(
    within(fieldset("Follow system")).getByRole("checkbox", { name: "Accent colour" })
  );
  await waitFor(() => expect(fieldset("Accent")).not.toBeDisabled());
  expect(ipc.settingsSet).toHaveBeenCalledWith({ follow: { accent: false } });

  fireEvent.click(within(fieldset("Accent")).getByRole("radio", { name: "Ocean" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenLastCalledWith({ accent: "ocean" }));
  // The theme is resolved with the pick, and with the system no longer followed for it.
  await waitFor(() =>
    expect(ipc.themeSetPrefs).toHaveBeenLastCalledWith(
      { colours: true, accent: false, fonts: true, radius: true },
      { mode: "system", accent: "ocean", density: "cozy" }
    )
  );
});

test("every_accent_is_offered_once", async () => {
  await shown();
  const names = within(fieldset("Accent"))
    .getAllByRole("radio")
    .map((r) => r.closest("label")?.textContent);
  // kernkraft-theme's KernAccent: twelve accents.
  expect(names).toHaveLength(12);
  expect(new Set(names).size).toBe(12);
});

test("wcag_fallback_note_shown", async () => {
  useThemeState.setState({
    theme: { css: "", tokens: {} as never, fallbacks: ["bg", "text"], problems: [] },
  });
  await shown();
  const notes = within(screen.getByTestId("wcag-notes")).getAllByRole("listitem");
  expect(notes.map((n) => n.textContent)).toEqual([
    "Your system's background colour fails WCAG AA contrast with its text; Kern uses its own here.",
    "Your system's text colour fails WCAG AA contrast on its background; Kern uses its own here.",
  ]);
});

test("a_setting_outside_the_theme_does_not_re_theme", async () => {
  await shown();
  fireEvent.click(screen.getByRole("checkbox", { name: "Wrap long lines" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalledWith({ word_wrap: true }));
  expect(ipc.themeSetPrefs).not.toHaveBeenCalled();
});

test("a_change_that_is_not_saved_is_said", async () => {
  ipc.settingsSet.mockRejectedValueOnce({ kind: "Io", message: "disk full", path: null });
  await shown();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show hidden items" }));
  expect(await screen.findByTestId("settings-problem")).toHaveTextContent(
    /Show hidden items was not saved: .*disk full/
  );
});

test("a_theme_that_cannot_follow_the_change_is_said", async () => {
  ipc.themeSetPrefs.mockRejectedValueOnce({ kind: "Bus", message: "no portal", path: null });
  await shown();
  fireEvent.click(within(fieldset("Density")).getByRole("radio", { name: "Compact" }));
  expect(await screen.findByTestId("settings-problem")).toHaveTextContent(
    /The density was saved, but the theme could not be changed to it: .*no portal/
  );
});

test("a_change_made_elsewhere_shows", async () => {
  await shown();
  await act(async () =>
    handlers["kern://settings-changed"]!({ ...stored, word_wrap: true } satisfies Settings)
  );
  expect(screen.getByRole("checkbox", { name: "Wrap long lines" })).toBeChecked();
});

test("an_unreadable_settings_file_is_reported", async () => {
  ipc.storeErrorsTake.mockResolvedValue([
    { file: "settings.json", moved_to: p("/c/settings.json.bad"), field: null, reason: "eof" },
    { file: "pins.json", moved_to: null, field: null, reason: "not here" },
  ]);
  await shown();
  const alert = await screen.findByText(/settings\.json could not be read/);
  expect(alert).toHaveTextContent(
    "settings.json could not be read: eof. It was kept as settings.json.bad and Kern started a fresh one."
  );
  // pins.json is Pinned and Recent's to report.
  expect(screen.queryByText(/pins\.json/)).toBeNull();
});

test("scan_roots_are_added_once_and_removed", async () => {
  await shown();
  const field = screen.getByLabelText("Add a folder");
  fireEvent.change(field, { target: { value: "~/Projects" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(ipc.settingsSet).toHaveBeenCalledWith({ scan_roots: [p("/home/t/Projects")] })
  );
  expect(await screen.findByText("/home/t/Projects")).toBeInTheDocument();
  expect(field).toHaveValue("");

  fireEvent.change(field, { target: { value: "/home/t/Projects" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/already in the list/);
  expect(ipc.settingsSet).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Remove /home/t/Projects" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenLastCalledWith({ scan_roots: [] }));
});

test("a_relative_scan_root_is_refused_with_the_reason", async () => {
  await shown();
  fireEvent.change(screen.getByLabelText("Add a folder"), { target: { value: "Projects" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(ipc.settingsSet).not.toHaveBeenCalled();
});

test("an_empty_terminal_setting_is_stored_as_none", async () => {
  stored.terminal = "kitty";
  await shown();
  const field = screen.getByLabelText("Terminal program");
  expect(field).toHaveValue("kitty");
  fireEvent.change(field, { target: { value: "  " } });
  fireEvent.click(within(fieldset("Terminal")).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalledWith({ terminal: null }));
});

test("default_fm_button_reflects_status", async () => {
  await shown();
  const status = await screen.findByText(/The default file manager is org\.kde\.dolphin\.desktop/);
  expect(status).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Make Kern the default file manager" });
  expect(button).toBeEnabled();
  expect(screen.getByTestId("fm1-status")).toHaveTextContent(/Kern answers other programs'/);

  ipc.makeDefaultFm.mockResolvedValue({
    is_default: true,
    current: "io.github.verycareful.kern.desktop",
  });
  fireEvent.click(button);
  expect(await screen.findByText("Kern is the default file manager.")).toBeInTheDocument();
  expect(button).toBeDisabled();
});

test("a_default_fm_that_cannot_be_set_is_said_and_another_bus_owner_named", async () => {
  ipc.fm1Status.mockResolvedValue({ owned: false, owner: "nautilus", reason: "name taken" });
  ipc.makeDefaultFm.mockRejectedValue({ kind: "XdgMime", message: "exit 1", path: null });
  await shown();
  expect(await screen.findByTestId("fm1-status")).toHaveTextContent(
    "Kern does not answer other programs' requests to show folders; nautilus answers them (name taken)."
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Make Kern the default file manager" })
  );
  expect(
    await screen.findByText(/could not be made the default file manager: .*exit 1/)
  ).toBeInTheDocument();
});

test("about_shows_label", async () => {
  await shown();
  // The label of this build, as the repository's VERSION file holds it.
  const label = readFileSync("VERSION", "utf8").trim();
  expect(screen.getByTestId("about-version")).toHaveTextContent(`Kern ${label}`);
  expect(screen.getByTestId("licence-text").textContent).toBe(readFileSync("LICENSE", "utf8"));
});

test("about_links_open_through_the_default_app_and_say_when_they_cannot", async () => {
  stored.terminal = "kitty";
  await shown();
  fireEvent.click(screen.getByRole("button", { name: "Kern for Android" }));
  await waitFor(() =>
    expect(ipc.openUrl).toHaveBeenCalledWith("https://github.com/verycareful/kern", "kitty")
  );
  // The terminal is the one the view shows, not a second read of the settings.
  expect(ipc.settingsGet).toHaveBeenCalledTimes(1);
  ipc.openUrl.mockRejectedValueOnce({ kind: "NoUrlHandler", message: "no browser", path: null });
  fireEvent.click(screen.getByRole("button", { name: "Source code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /https:\/\/github\.com\/verycareful\/kern-desktop could not be opened: .*no browser/
  );
  expect(screen.queryByText(/[Qq]yra/)).toBeNull();
});

test("a_listener_that_failed_stays_said_after_a_change", async () => {
  ipc.on.mockRejectedValueOnce({ kind: "Io", message: "no events", path: null });
  await shown();
  expect(
    screen.getByText(/changed in another window will not show here: .*no events/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Wrap long lines" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalled());
  expect(screen.getByText(/changed in another window will not show here/)).toBeInTheDocument();
});

test("retry_reads_again_and_keeps_following", async () => {
  ipc.settingsGet.mockRejectedValueOnce({ kind: "Io", message: "busy", path: null });
  render(<SettingsView />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Appearance" });
  // One subscription to settings changes, kept through the retry.
  expect(ipc.on.mock.calls.filter(([name]) => name === "kern://settings-changed")).toHaveLength(1);
  await act(async () =>
    handlers["kern://settings-changed"]!({ ...stored, word_wrap: true } satisfies Settings)
  );
  expect(screen.getByRole("checkbox", { name: "Wrap long lines" })).toBeChecked();
});

test("an_earlier_answer_arriving_late_does_not_put_the_control_back", async () => {
  await shown();
  const answers: ((s: Settings) => void)[] = [];
  ipc.settingsSet.mockImplementation(
    (patch: Partial<Settings>) =>
      new Promise<Settings>((resolve) => {
        const next = { ...stored, ...patch };
        stored = next;
        answers.push(() => resolve(next));
      })
  );
  const zoom = screen.getByLabelText("Text size");
  fireEvent.change(zoom, { target: { value: "1.25" } });
  fireEvent.change(zoom, { target: { value: "1.5" } });
  await waitFor(() => expect(answers).toHaveLength(2));
  await act(async () => answers[1]!(stored));
  await act(async () => answers[0]!(stored));
  expect(screen.getByText("150%")).toBeInTheDocument();
});

test("a_folder_added_while_another_window_added_one_keeps_both", async () => {
  let dirs!: (v: unknown) => void;
  ipc.userDirs.mockReturnValue(new Promise((r) => (dirs = r)));
  await shown();
  fireEvent.change(screen.getByLabelText("Add a folder"), { target: { value: "/b" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await act(async () =>
    handlers["kern://settings-changed"]!({ ...stored, scan_roots: [p("/a")] } satisfies Settings)
  );
  await act(async () => dirs({ home: p("/home/t"), dirs: [] }));
  await waitFor(() =>
    expect(ipc.settingsSet).toHaveBeenCalledWith({ scan_roots: [p("/a"), p("/b")] })
  );
});

test("a_terminal_that_differs_only_by_spaces_is_not_a_change", async () => {
  stored.terminal = "kitty";
  await shown();
  fireEvent.change(screen.getByLabelText("Terminal program"), { target: { value: " kitty " } });
  expect(within(fieldset("Terminal")).getByRole("button", { name: "Save" })).toBeDisabled();
});

test("the_default_layout_for_new_windows_is_chosen_and_stored", async () => {
  await shown();
  const layouts = fieldset("Default layout of the main window");
  expect(within(layouts).getByRole("radio", { name: "File manager" })).toBeChecked();
  fireEvent.click(within(layouts).getByRole("radio", { name: "Editor" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalledWith({ default_layout: "editor" }));
  await waitFor(() => expect(within(layouts).getByRole("radio", { name: "Editor" })).toBeChecked());
  // A change made elsewhere shows too.
  act(() =>
    handlers["kern://settings-changed"]!({
      ...stored,
      default_layout: "file_manager",
    } satisfies Settings)
  );
  await waitFor(() =>
    expect(within(layouts).getByRole("radio", { name: "File manager" })).toBeChecked()
  );
});

test("a_default_layout_that_is_not_saved_is_said", async () => {
  await shown();
  ipc.settingsSet.mockRejectedValueOnce({
    kind: "Io",
    message: "disk full",
    path: null,
    details: null,
  });
  fireEvent.click(
    within(fieldset("Default layout of the main window")).getByRole("radio", { name: "Editor" })
  );
  expect(await screen.findByTestId("settings-problem")).toHaveTextContent(
    /The default layout was not saved: .*disk full/
  );
});
