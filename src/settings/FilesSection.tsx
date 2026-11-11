// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useState } from "react";
import {
  defaultFmStatus,
  displayPath,
  fm1Status,
  makeDefaultFm,
  pinsClear,
  recentsClear,
  toWireError,
  type DefaultFm,
  type Fm1Status,
  type FolderMenu,
  type LayoutKind,
  type NewTabDefault,
  type TimeFormat,
  type Settings,
  type ViewMode,
  type WireError,
} from "../ipc";
import { parseLocation } from "../files/path-input";
import { errorText } from "../ops/error-text";
import { useUserDirs } from "../shell/user-dirs-store";
import { useSettingsDraft } from "./settings-draft";
import { ClearList } from "./ClearList";
import { PanelOrder } from "./PanelOrder";
import { Choices, Group, Row, Toggle } from "./settings-ui";

// Files: the main window's layout, what a new tab opens and which of the
// two new tabs Ctrl+T opens, list or grid and hidden items in a new folder view, the Terminal program, and whether Kern is the default file manager (default_fm.rs:
// the inode/directory default, and the org.freedesktop.FileManager1 name other programs ask to
// show folders). Making Kern the default is an action on the system, not a setting: it happens
// when its button is pressed, not at Save. Clearing the pins or the recents is an action too,
// asked about first: the lists are empty in every window at once and nothing brings them back.

const VIEWS: readonly { value: ViewMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

// The main window takes the file manager layout only (the backend's MAIN_LAYOUTS); the editor
// layout is shown, greyed, as the one an editor window has.
const LAYOUTS: readonly { value: LayoutKind; label: string; disabled?: boolean }[] = [
  { value: "file_manager", label: "File manager" },
  { value: "editor", label: "Editor", disabled: true },
];

const NEW_TAB_DEFAULTS: readonly { value: NewTabDefault; label: string }[] = [
  { value: "folder", label: "New tab folder" },
  { value: "current", label: "Current folder" },
];

const FOLDER_MENUS: readonly { value: FolderMenu; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "collapsed", label: "Collapsed" },
  { value: "expanded", label: "Expanded" },
];

const TIME_FORMATS: readonly { value: TimeFormat; label: string }[] = [
  { value: "system", label: "System default" },
  { value: "12", label: "12-hour" },
  { value: "24", label: "24-hour" },
];

// What the panels are called in the order rows. The file manager's columns are its places panel,
// the folder area and Pinned and Recent; the editor layout's places panel is the column with the
// folder tree under it.
const FILE_MANAGER_PANEL_NAMES = {
  places: "Places",
  folder: "Files",
  pinned: "Pinned and Recent",
} as const;

const EDITOR_PANEL_NAMES = { places: "Places and folders", pinned: "Pinned and Recent" } as const;

type Click = "double" | "single";

const CLICKS: readonly { value: Click; label: string }[] = [
  { value: "double", label: "Double click" },
  { value: "single", label: "Single click" },
];

type ClickKey =
  "single_click_left" | "single_click_right" | "single_click_centre" | "single_click_editor";

// One row per area. Enter and Space open in every area whatever the choice; the top bar buttons
// always open on one click, and a folder row of the editor tree always expands on one click.
const CLICK_ROWS: readonly { key: ClickKey; label: string; note: string }[] = [
  {
    key: "single_click_left",
    label: "Left panel opens with",
    note: "Places, volumes, Trash and Library, and the strip of the other layout. Enter always opens.",
  },
  {
    key: "single_click_right",
    label: "Right panel opens with",
    note: "Pinned and recent entries.",
  },
  {
    key: "single_click_centre",
    label: "File manager opens with",
    note: "List and grid, and search hits shown there. Ctrl, Shift or Meta with a click only selects.",
  },
  {
    key: "single_click_editor",
    label: "Editor window opens with",
    note: "File rows of the tree, and search hits shown there. A folder row always opens on one click.",
  },
];

type NewTabPlace = "home" | "other";

const NEW_TAB_PLACES: readonly { value: NewTabPlace; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "other", label: "Another folder" },
];

// Home, or a folder typed as a path (~ for Home), as a Library folder is. The path is taken when
// the field is left or Enter is pressed; until a path is taken, Another folder changes nothing.
function NewTabFolder(props: { settings: Settings }) {
  const id = useId();
  const edit = useSettingsDraft((s) => s.edit);
  const folder = props.settings.new_tab_folder;
  const [other, setOther] = useState(folder !== null);
  const [text, setText] = useState(folder ? displayPath(folder) : "");
  const [error, setError] = useState<string | null>(null);
  // A change made elsewhere (Revert, another window) shows here.
  const [seen, setSeen] = useState(folder);
  if (seen !== folder) {
    setSeen(folder);
    setOther(folder !== null);
    setText(folder ? displayPath(folder) : "");
    setError(null);
  }

  const take = async () => {
    let home = null;
    try {
      home = (await useUserDirs.getState().load()).home;
    } catch {
      // ~ is then refused by parseLocation with its own words.
    }
    const parsed = parseLocation(text, home);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    edit({ new_tab_folder: parsed.path });
  };

  const choose = (place: NewTabPlace) => {
    setOther(place === "other");
    setError(null);
    if (place === "home") edit({ new_tab_folder: null });
  };

  return (
    <Row
      id="new_tab_folder"
      wide
      note="What New tab opens. A folder that is gone opens as a tab that says so, not as Home."
    >
      <Choices
        label="New tab folder"
        value={other ? "other" : "home"}
        options={NEW_TAB_PLACES}
        onChange={choose}
      />
      {other && (
        <div className="kern-settings-inline">
          <label htmlFor={`${id}-folder`} className="kern-settings-hidden-label">
            Folder for new tabs
          </label>
          <input
            id={`${id}-folder`}
            type="text"
            className="kern-modal-input"
            spellCheck={false}
            placeholder="~/Projects"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void take()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void take();
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
    </Row>
  );
}

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
      note="Kern opens a terminal with this program when one is set, else with the first terminal your xdg-terminals.list files name, else with $TERMINAL, else with any installed terminal. It is one program, not a command line: Kern adds -e and the command when there is one to run."
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
          note="The main window is a file manager. The editor layout, a folder tree beside your documents, is not available for the main window yet: open a folder as an editor for it."
        >
          <Choices
            label="Main window layout"
            value={settings.default_layout}
            options={LAYOUTS}
            onChange={(default_layout) => edit({ default_layout })}
          />
        </Row>
      </Group>
      <Group rows={["panel_order", "editor_panel_order"]}>
        <Row
          id="panel_order"
          wide
          note="The three columns of the file manager, left to right. Applies at once in every window."
        >
          <PanelOrder
            label="File manager panel order"
            order={settings.panel_order}
            names={FILE_MANAGER_PANEL_NAMES}
            onChange={(panel_order) => edit({ panel_order })}
          />
        </Row>
        <Row
          id="editor_panel_order"
          wide
          note="The two panels either side of the editor in an editor window, left to right."
        >
          <PanelOrder
            label="Editor window panel order"
            order={settings.editor_panel_order}
            names={EDITOR_PANEL_NAMES}
            between="Editor"
            onChange={(editor_panel_order) => edit({ editor_panel_order })}
          />
        </Row>
      </Group>
      <Group rows={["new_tab_folder", "new_tab_default"]}>
        <NewTabFolder settings={settings} />
        <Row
          id="new_tab_default"
          note="New tab here opens the folder of the tab in front. The other of the two is on Ctrl+Shift+T."
        >
          <Choices
            label="Ctrl+T opens"
            value={settings.new_tab_default}
            options={NEW_TAB_DEFAULTS}
            onChange={(new_tab_default) => edit({ new_tab_default })}
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
      <Group rows={CLICK_ROWS.map((r) => r.key)}>
        {CLICK_ROWS.map((r) => (
          <Row key={r.key} id={r.key} note={r.note}>
            <Choices
              label={r.label}
              value={settings[r.key] ? "single" : "double"}
              options={CLICKS}
              onChange={(click) => edit({ [r.key]: click === "single" })}
            />
          </Row>
        ))}
      </Group>
      <Group rows={["time_format"]}>
        <Row
          id="time_format"
          note="The time beside the date in the Modified column. System default follows the locale."
        >
          <Choices
            label="Time of day in dates"
            value={settings.time_format}
            options={TIME_FORMATS}
            onChange={(time_format) => edit({ time_format })}
          />
        </Row>
      </Group>
      <Group rows={["folder_menu"]}>
        <Row
          id="folder_menu"
          note="Standard keeps the most used entries on top and folds the rest into submenus. Collapsed folds every group. Expanded lists everything at once."
        >
          <Choices
            label="Right-click menu of the file manager"
            value={settings.folder_menu}
            options={FOLDER_MENUS}
            onChange={(folder_menu) => edit({ folder_menu })}
          />
        </Row>
      </Group>
      <Group rows={["terminal", "default_fm"]}>
        <Terminal settings={settings} />
        <DefaultFileManager />
      </Group>
      <Group rows={["clear_pins", "clear_recents"]}>
        <ClearList
          id="clear_pins"
          note="Unpins every pinned folder and file in every window. The pinned items themselves are not touched."
          button="Clear pins"
          title="Clear all pins?"
          text="Every pin is removed from the right panel of every window. The folders and files stay where they are, and you can pin them again."
          done="The pins are cleared."
          failed="The pins could not be cleared"
          clear={pinsClear}
        />
        <ClearList
          id="clear_recents"
          note="Empties the list of recently opened folders and files in every window. The items themselves are not touched."
          button="Clear recents"
          title="Clear all recents?"
          text="The list of recent folders and files is emptied in every window. The folders and files stay where they are; opening them again fills the list."
          done="The recents are cleared."
          failed="The recents could not be cleared"
          clear={recentsClear}
        />
      </Group>
    </>
  );
}
