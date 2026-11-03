// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useRef, useState } from "react";
import { displayPath, type WireEntry, type WirePath } from "../ipc";
import { formatDate, formatSize } from "../files/format";
import { parseLocation } from "../files/path-input";
import { useUserDirs } from "../shell/user-dirs-store";
import { Modal } from "../ops/Modal";
import { baseName } from "../ops/labels";
import type { SaveAsResult } from "./useTextDoc";

// The questions a save can ask. Each dialog names what the
// answer does to the file, and the safe answer, Cancel, has the focus.

/** The file changed on disk since it was opened: Reload, Overwrite, Save As or Cancel. */
export function ExternalModificationPrompt(props: {
  path: WirePath;
  dirty: boolean;
  onReload(): void;
  onOverwrite(): void;
  onSaveAs(): void;
  onCancel(): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const name = baseName(props.path);
  return (
    <Modal
      role="alertdialog"
      label="The file changed on disk"
      initialFocus={cancel}
      onEscape={props.onCancel}
      testId="external-prompt"
    >
      <h2 className="kern-modal-title">{name} changed on the disk</h2>
      <p className="kern-modal-text">
        Another program changed this file after you opened it. Your text was not saved.
      </p>
      <ul className="kern-modal-text">
        <li>
          Reload reads the file from the disk
          {props.dirty ? " and discards your unsaved changes" : ""}.
        </li>
        <li>Overwrite replaces what is on the disk with your text; the other changes are lost.</li>
        <li>Save As keeps your text in another file and leaves this one alone.</li>
      </ul>
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={props.onReload}>
          Reload
        </button>
        <button type="button" className="kern-button" onClick={props.onOverwrite}>
          Overwrite
        </button>
        <button type="button" className="kern-button" onClick={props.onSaveAs}>
          Save As…
        </button>
        <button ref={cancel} type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The file was deleted on disk: saving would create it again. */
export function RecreatePrompt(props: {
  path: WirePath;
  onRecreate(): void;
  onSaveAs(): void;
  onCancel(): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      role="alertdialog"
      label="The file was deleted"
      initialFocus={cancel}
      onEscape={props.onCancel}
      testId="recreate-prompt"
    >
      <h2 className="kern-modal-title">{baseName(props.path)} was deleted</h2>
      <p className="kern-modal-text">
        This file is no longer on the disk. Saving creates it again at {displayPath(props.path)}.
      </p>
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={props.onRecreate}>
          Create the file again
        </button>
        <button type="button" className="kern-button" onClick={props.onSaveAs}>
          Save As…
        </button>
        <button ref={cancel} type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const KIND_WORD: Record<string, string> = { file: "file", symlink: "link", other: "item" };

/**
 * Save As: asks for a path (typed as in the location bar). When something is
 * already there it says what, and what replacing it loses, and writes only after
 * Replace. A refusal of the backend stays in the dialog for another try.
 */
export function SaveAsDialog(props: {
  /** The file the document shows now; the field starts with its path. */
  path: WirePath;
  /** Set when the text shown is a lossy copy of the file, which Save As would keep as it is shown. */
  lossyNote: string | null;
  save(target: WirePath, replace: WireEntry | null): Promise<SaveAsResult>;
  onCancel(): void;
}) {
  const [text, setText] = useState(displayPath(props.path));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<{ target: WirePath; entry: WireEntry } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The question opens on the choice that writes nothing, so a key held down replaces nothing.
  const anotherName = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const id = useId();

  useEffect(() => {
    alive.current = true;
    input.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const attempt = async (target: WirePath, replace: WireEntry | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await props.save(target, replace);
      if (!alive.current) return;
      if (r.status === "exists") {
        setExisting({ target, entry: r.entry });
        // What the question described is not what is there now: it is asked again.
        if (replace) setError("It changed since you were asked. This is what is there now.");
      } else if (r.status === "failed") {
        setExisting(null);
        setError(r.message);
      }
      // "saved": the document closes this dialog by clearing its prompt.
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    let home: WirePath | null = null;
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
    if (!alive.current) return;
    await attempt(parsed.path, null);
  };

  if (existing) {
    const { entry, target } = existing;
    const what = KIND_WORD[entry.kind] ?? "item";
    return (
      <Modal
        role="alertdialog"
        label="Replace the existing file"
        initialFocus={anotherName}
        onEscape={props.onCancel}
        testId="replace-prompt"
      >
        <h2 className="kern-modal-title">Replace {baseName(target)}?</h2>
        <p className="kern-modal-text">
          A {what} with this name is already at {displayPath(target)} ({formatSize(entry.len)},
          modified {formatDate(entry.modified_ms)}). Replacing it overwrites it with this document,
          and what it holds now is lost.
        </p>
        {error && (
          <p role="alert" className="kern-modal-error">
            {error}
          </p>
        )}
        <div className="kern-modal-actions">
          <button
            type="button"
            className="kern-button"
            disabled={busy}
            onClick={() => void attempt(target, entry)}
          >
            Replace
          </button>
          <button
            ref={anotherName}
            type="button"
            className="kern-button"
            onClick={() => setExisting(null)}
          >
            Choose another name
          </button>
          <button type="button" className="kern-button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      role="dialog"
      label="Save As"
      initialFocus={input}
      onEscape={props.onCancel}
      testId="save-as-dialog"
    >
      <h2 className="kern-modal-title">Save As</h2>
      {props.lossyNote && <p className="kern-modal-text">{props.lossyNote}</p>}
      <label className="kern-modal-text" htmlFor={`${id}-path`}>
        Path of the new file
      </label>
      <input
        id={`${id}-path`}
        ref={input}
        type="text"
        className="kern-modal-input"
        spellCheck={false}
        value={text}
        readOnly={busy}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" disabled={busy} onClick={() => void submit()}>
          Save
        </button>
        <button type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
