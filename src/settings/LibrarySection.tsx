// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useState } from "react";
import { displayPath, pathKey, type Settings } from "../ipc";
import { parseLocation } from "../files/path-input";
import { useUserDirs } from "../shell/user-dirs-store";
import { shown, useSettingsDraft } from "./settings-draft";
import { Group, Row, Toggle } from "./settings-ui";

// Library: whether the Library walks the Documents and Downloads folders, and the folders of the
// user's own it walks besides. A folder is typed as a path (~ for Home); one already in the list
// is refused with the reason.

function ScanRoots(props: { settings: Settings }) {
  const id = useId();
  const edit = useSettingsDraft((s) => s.edit);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const roots = props.settings.scan_roots;

  const add = async () => {
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
    // The list as it is now: it may have changed while the home folder was looked up.
    const now = shown(useSettingsDraft.getState())?.scan_roots ?? roots;
    const key = pathKey(parsed.path);
    if (now.some((r) => pathKey(r) === key)) {
      setError(`${displayPath(parsed.path)} is already in the list.`);
      return;
    }
    setError(null);
    edit({ scan_roots: [...now, parsed.path] });
    setText("");
  };

  return (
    <Row id="scan_roots" wide note="The Library walks these as well">
      {roots.length === 0 ? (
        <p className="kern-settings-hint">None besides Documents and Downloads.</p>
      ) : (
        <ul className="kern-settings-list" data-testid="scan-roots">
          {roots.map((r) => (
            <li key={pathKey(r)}>
              <span className="kern-settings-path">{displayPath(r)}</span>
              <button
                type="button"
                className="kern-button"
                aria-label={`Remove ${displayPath(r)}`}
                onClick={() => edit({ scan_roots: roots.filter((x) => pathKey(x) !== pathKey(r)) })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="kern-settings-inline">
        <label htmlFor={`${id}-root`} className="kern-settings-hidden-label">
          Add a folder
        </label>
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
      </div>
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
    </Row>
  );
}

export function LibrarySection(props: { settings: Settings }) {
  const { settings } = props;
  const edit = useSettingsDraft((s) => s.edit);
  return (
    <Group rows={["scan_documents", "scan_downloads", "scan_roots"]}>
      <Row id="scan_documents" note="Your Documents folder">
        <Toggle
          label="Walk Documents"
          on={settings.scan_documents}
          onChange={(scan_documents) => edit({ scan_documents })}
        />
      </Row>
      <Row id="scan_downloads" note="Your Downloads folder">
        <Toggle
          label="Walk Downloads"
          on={settings.scan_downloads}
          onChange={(scan_downloads) => edit({ scan_downloads })}
        />
      </Row>
      <ScanRoots settings={settings} />
    </Group>
  );
}
