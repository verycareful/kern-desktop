// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useRef, useState } from "react";
import type { WirePath } from "../ipc";
import { Modal } from "../ops/Modal";
import { baseName } from "../ops/labels";

/**
 * An encrypted PDF asks for its password. Escape or Cancel gives up on the file: the tab then
 * says why it did not open. `wrong` is shown when the last password tried was refused.
 */
export function PasswordPrompt(props: {
  path: WirePath;
  wrong: boolean;
  onSubmit(password: string): void;
  onCancel(): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const name = baseName(props.path);
  return (
    <Modal
      role="dialog"
      label="Password required"
      initialFocus={input}
      onEscape={props.onCancel}
      testId="password-prompt"
    >
      <h2 className="kern-modal-title">{name} is password protected</h2>
      <label className="kern-modal-text" htmlFor={`${id}-password`}>
        Password
      </label>
      <input
        id={`${id}-password`}
        ref={input}
        type="password"
        className="kern-modal-input"
        autoComplete="off"
        spellCheck={false}
        value={password}
        aria-invalid={props.wrong}
        aria-describedby={props.wrong ? `${id}-wrong` : undefined}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onSubmit(password);
          }
        }}
      />
      {props.wrong && (
        <p id={`${id}-wrong`} role="alert" className="kern-modal-error">
          That password does not open the file.
        </p>
      )}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={() => props.onSubmit(password)}>
          Open
        </button>
        <button type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
