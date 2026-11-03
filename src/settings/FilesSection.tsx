// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useState } from "react";
import {
  defaultFmStatus,
  displayPath,
  fm1Status,
  makeDefaultFm,
  pathKey,
  toWireError,
  type DefaultFm,
  type Fm1Status,
  type LayoutKind,
  type Settings,
  type ViewMode,
  type WireError,
} from "../ipc";
import { parseLocation } from "../files/path-input";
import { errorText } from "../ops/error-text";
import { useUserDirs } from "../shell/user-dirs-store";
import { useSettings } from "./settings-store";

// Files: the folders All documents walks (Documents and
// Downloads, and folders of the user's own), whether hidden items show and
// list or grid in a new folder view, the layout of a window that has none yet, the Terminal command, and whether Kern
// is the default file manager (default_fm.rs: the inode/directory default, and the
// org.freedesktop.FileManager1 name other programs ask to show folders).

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

const LAYOUTS: { value: LayoutKind; label: string }[] = [
  { value: "file_manager", label: "File manager" },
  { value: "editor", label: "Editor" },
];

type Load<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: WireError };

function ScanRoots(props: { settings: Settings }) {
  const { settings } = props;
  const id = useId();
  const change = useSettings((s) => s.change);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const roots = settings.scan_roots;

  const add = async () => {
    const typed = text;
    let home = null;
    try {
      home = (await useUserDirs.getState().load()).home;
    } catch {
      // ~ is then refused by parseLocation with its own words.
    }
    const parsed = parseLocation(typed, home);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    // The list as it is now: it may have changed while the home folder was looked up.
    const now = useSettings.getState().settings?.scan_roots ?? roots;
    const key = pathKey(parsed.path);
    if (now.some((r) => pathKey(r) === key)) {
      setError(`${displayPath(parsed.path)} is already in the list.`);
      return;
    }
    setError(null);
    if (await change({ scan_roots: [...now, parsed.path] }, "The folder")) setText("");
  };

  return (
    <fieldset>
      <legend>Folders All documents also walks</legend>
      {roots.length === 0 ? (
        <p className="kern-settings-note">None besides Documents and Downloads.</p>
      ) : (
        <ul className="kern-settings-list" data-testid="scan-roots">
          {roots.map((r) => (
            <li key={pathKey(r)}>
              <span>{displayPath(r)}</span>
              <button
                type="button"
                className="kern-button"
                aria-label={`Remove ${displayPath(r)}`}
                onClick={() =>
                  void change(
                    { scan_roots: roots.filter((x) => pathKey(x) !== pathKey(r)) },
                    "Removing the folder"
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${id}-root`}>Add a folder</label>
      <input
        id={`${id}-root`}
        type="text"
        className="kern-modal-input"
        spellCheck={false}
        placeholder="~/Projects"
        value={text}
        aria-invalid={error !== null}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
      />
      <button type="button" className="kern-button" onClick={() => void add()}>
        Add
      </button>
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Terminal(props: { settings: Settings }) {
  const id = useId();
  const change = useSettings((s) => s.change);
  const stored = props.settings.terminal ?? "";
  const [text, setText] = useState(stored);
  useEffect(() => setText(stored), [stored]);
  const save = () => {
    const value = text.trim();
    void change({ terminal: value === "" ? null : value }, "The terminal command");
  };
  return (
    <fieldset>
      <legend>Terminal</legend>
      <label htmlFor={`${id}-term`}>Terminal program</label>
      <input
        id={`${id}-term`}
        type="text"
        className="kern-modal-input"
        spellCheck={false}
        placeholder="kitty"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      <button
        type="button"
        className="kern-button"
        disabled={text.trim() === stored}
        onClick={save}
      >
        Save
      </button>
      <p className="kern-settings-note">
        Kern opens a terminal with xdg-terminal-exec when it is installed, else with $TERMINAL, else
        with this program. It is one program, not a command line: Kern adds -e and the command when
        there is one to run.
      </p>
    </fieldset>
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
    <fieldset>
      <legend>Default file manager</legend>
      <p role="status" className="kern-settings-note" data-testid="default-fm-status">
        {status}
      </p>
      <button
        type="button"
        className="kern-button"
        disabled={making || fm.state !== "ready" || fm.value.is_default}
        onClick={() => void make()}
      >
        Make Kern the default file manager
      </button>
      {busText && (
        <p className="kern-settings-note" data-testid="fm1-status">
          {busText}
        </p>
      )}
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function FilesSection(props: { settings: Settings }) {
  const { settings } = props;
  const id = useId();
  const change = useSettings((s) => s.change);
  return (
    <section className="kern-settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Files</h2>
      <fieldset>
        <legend>All documents</legend>
        <label className="kern-settings-choice">
          <input
            type="checkbox"
            checked={settings.scan_documents}
            onChange={(e) => void change({ scan_documents: e.target.checked }, "Documents")}
          />
          Walk Documents
        </label>
        <label className="kern-settings-choice">
          <input
            type="checkbox"
            checked={settings.scan_downloads}
            onChange={(e) => void change({ scan_downloads: e.target.checked }, "Downloads")}
          />
          Walk Downloads
        </label>
      </fieldset>
      <ScanRoots settings={settings} />
      <fieldset>
        <legend>New folder views</legend>
        <label className="kern-settings-choice">
          <input
            type="checkbox"
            checked={settings.show_hidden}
            onChange={(e) => void change({ show_hidden: e.target.checked }, "Show hidden items")}
          />
          Show hidden items
        </label>
        {VIEWS.map((v) => (
          <label key={v.value} className="kern-settings-choice">
            <input
              type="radio"
              name={`${id}-view`}
              checked={settings.view_mode === v.value}
              onChange={() => void change({ view_mode: v.value }, "The view")}
            />
            {v.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Default layout of the main window</legend>
        {LAYOUTS.map((l) => (
          <label key={l.value} className="kern-settings-choice">
            <input
              type="radio"
              name={`${id}-layout`}
              checked={settings.default_layout === l.value}
              onChange={() => void change({ default_layout: l.value }, "The default layout")}
            />
            {l.label}
          </label>
        ))}
        <p className="kern-settings-note">
          The file manager has the places on the left and Pinned and Recent on the right. The editor
          keeps a folder tree on the left whatever tab is shown. This is the layout of the main
          window when it has none remembered yet: the first time Kern starts, and a main window made
          anew. A layout you switch to is remembered and wins. Open as editor always makes an editor
          window.
        </p>
      </fieldset>
      <Terminal settings={settings} />
      <DefaultFileManager />
    </section>
  );
}
