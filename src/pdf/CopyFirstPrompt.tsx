// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef } from "react";
import type { WirePath } from "../ipc";
import { Modal } from "../ops/Modal";
import { baseName } from "../ops/labels";
import type { CopyFirstChoice } from "./usePdfSave";

// Asked once per opened PDF, before its first change: a PDF is saved over the file it came from, so
// the way back to the file as it is now is a copy made before the change. Cancel makes no change
// and has the focus, so a key held down changes nothing.
export function CopyFirstPrompt(props: {
  path: WirePath;
  /** The copy is being made. */
  copying: boolean;
  onChoose(choice: CopyFirstChoice): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const name = baseName(props.path);
  return (
    <Modal
      role="alertdialog"
      label="Keep a copy of the PDF first"
      initialFocus={cancel}
      onEscape={() => !props.copying && props.onChoose("cancel")}
      testId="copy-first-prompt"
    >
      <h2 className="kern-modal-title">Keep a copy of {name} first?</h2>
      <p className="kern-modal-text">
        Saving writes your changes into {name} itself. A copy made now, byte for byte, stays as the
        file is today and is never replaced.
      </p>
      {props.copying && (
        <p role="status" className="kern-modal-text">
          Copying…
        </p>
      )}
      <div className="kern-modal-actions">
        <button
          type="button"
          className="kern-button"
          disabled={props.copying}
          onClick={() => props.onChoose("copy")}
        >
          Save a copy first
        </button>
        <button
          type="button"
          className="kern-button"
          disabled={props.copying}
          onClick={() => props.onChoose("without")}
        >
          Edit without a copy
        </button>
        <button
          ref={cancel}
          type="button"
          className="kern-button"
          disabled={props.copying}
          onClick={() => props.onChoose("cancel")}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
