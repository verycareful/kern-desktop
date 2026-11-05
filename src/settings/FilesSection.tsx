// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useState } from "react";
import {
  defaultFmStatus,
  fm1Status,
  makeDefaultFm,
  toWireError,
  type DefaultFm,
  type Fm1Status,
  type LayoutKind,
  type Settings,
  type ViewMode,
  type WireError,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { useSettingsDraft } from "./settings-draft";
import { Choices, Group, Row, Toggle } from "./settings-ui";

// Files: the layout of a main window that has none yet, list or grid and hidden items in a new
// folder view, the Terminal program, and whether Kern is the default file manager (default_fm.rs:
// the inode/directory default, and the org.freedesktop.FileManager1 name other programs ask to
// show folders). Making Kern the default is an action on the system, not a setting: it happens
// when its button is pressed, not at Save.

const VIEWS: readonly { value: ViewMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

const LAYOUTS: readonly { value: LayoutKind; label: string }[] = [
  { value: "file_manager", label: "File manager" },
  { value: "editor", label: "Editor" },
];

type Load<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: WireError };

function Terminal(props: { settings: Settings }) {
  const id = useId();
  const edit = useSettingsDraft((s) => s.edit);
  const value = props.settings.terminal ?? "";
  const set = (text: string) => edit({ terminal: text === "" ? null : text });
  return (
    <Row
      id="terminal"
      htmlFor={`${id}-term`}
      wide
      note="Kern opens a terminal with xdg-terminal-exec when it is installed, else with $TERMINAL, else with this program. It is one program, not a command line: Kern adds -e and the command when there is one to run."
    >
      <input
        id={`${id}-term`}
        type="text"
        className="kern-modal-input"
        spellCheck={false}
        placeholder="kitty"
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={(e) => set(e.target.value.trim())}
      />
    </Row>
  );
}

function DefaultFileManager() {
  const [fm, setFm] = useState<Load<DefaultFm>>({ state: "loading" });
  const [bus, setBus] = useState<Load<Fm1Status>>({ state: "loading" });
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    defaultFmStatus().then(
      (value) => live && setFm({ state: "ready", value }),
      (e: unknown) => live && setFm({ state: "failed", error: toWireError(e) })
    );
    fm1Status().then(
      (value) => live && setBus({ state: "ready", value }),
      (e: unknown) => live && setBus({ state: "failed", error: toWireError(e) })
    );
    return () => {
      live = false;
    };
  }, []);

  const make = async () => {
    setMaking(true);
    setError(null);
    try {
      setFm({ state: "ready", value: await makeDefaultFm() });
    } catch (e) {
      setError(`Kern could not be made the default file manager: ${errorText(toWireError(e))}`);
    } finally {
      setMaking(false);
    }
  };

  let status: string;
  if (fm.state === "loading") status = "Looking up the default file manager…";
  else if (fm.state === "failed") {
    status = `The default file manager could not be found out: ${errorText(fm.error)}`;
  } else if (fm.value.is_default) status = "Kern is the default file manager.";
  else if (fm.value.current) status = `The default file manager is ${fm.value.current}.`;
  else status = "No default file manager is set.";

  let busText: string;
  if (bus.state === "loading") busText = "";
  else if (bus.state === "failed") {
    busText = `Whether Kern answers requests to show folders could not be found out: ${errorText(bus.error)}`;
  } else if (bus.value.owned) {
    busText = "Kern answers other programs' requests to show folders (FileManager1).";
  } else {
    const who = bus.value.owner ? `${bus.value.owner} answers them` : "nothing answers them";
    const why = bus.value.reason ? ` (${bus.value.reason})` : "";
    busText = `Kern does not answer other programs' requests to show folders; ${who}${why}.`;
  }

  return (
    <Row
      id="default_fm"
      wide
      note={
        <span role="status" data-testid="default-fm-status">
          {status}
        </span>
      }
    >
      <div className="kern-settings-inline">
        <button
          type="button"
          className="kern-button"
          disabled={making || fm.state !== "ready" || fm.value.is_default}
          onClick={() => void make()}
        >
          Make Kern the default file manager
        </button>
        <span className="kern-settings-hint">Happens at once, not at Save.</span>
      </div>
      {busText && (
        <p className="kern-settings-hint" data-testid="fm1-status">
          {busText}
        </p>
      )}
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
    </Row>
  );
}

export function FilesSection(props: { settings: Settings }) {
  const { settings } = props;
  const edit = useSettingsDraft((s) => s.edit);
  return (
    <>
      <Group rows={["default_layout"]}>
        <Row
          id="default_layout"
          note="For a main window with no layout remembered yet. A layout you switch to is remembered and wins."
        >
          <Choices
            label="Main window opens as"
            value={settings.default_layout}
            options={LAYOUTS}
            onChange={(default_layout) => edit({ default_layout })}
          />
        </Row>
      </Group>
      <Group rows={["view_mode", "show_hidden"]}>
        <Row id="view_mode" note="List or grid">
          <Choices
            label="View of new folder views"
            value={settings.view_mode}
            options={VIEWS}
            onChange={(view_mode) => edit({ view_mode })}
          />
        </Row>
        <Row id="show_hidden" note="Dotfiles in new folder views">
          <Toggle
            label="Show hidden items"
            on={settings.show_hidden}
            onChange={(show_hidden) => edit({ show_hidden })}
          />
        </Row>
      </Group>
      <Group rows={["terminal", "default_fm"]}>
        <Terminal settings={settings} />
        <DefaultFileManager />
      </Group>
    </>
  );
}
