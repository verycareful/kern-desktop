// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import { openAddress } from "../ipc/opener";
import { toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { Modal } from "../ops/Modal";

// A link that leaves the document asks first, with the whole address in view: the words of a link
// can say one thing and point at another. The address is handed to the system only by the Open
// button, which is not the one that has the focus.
export function LinkPrompt(props: { url: string; onClose(): void }) {
  const { url, onClose } = props;
  const cancel = useRef<HTMLButtonElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const open = () => {
    openAddress(url).then(onClose, (e: unknown) => setFailure(errorText(toWireError(e))));
  };
  return (
    <Modal
      role="dialog"
      label="Open this link"
      initialFocus={cancel}
      onEscape={onClose}
      testId="link-prompt"
    >
      <h2 className="kern-modal-title">Open this link?</h2>
      <p className="kern-modal-text">This PDF links to an address outside Kern:</p>
      <p className="kern-link-address" data-testid="link-address">
        {url}
      </p>
      {failure && (
        <p role="alert" className="kern-modal-error">
          The link could not be opened: {failure}
        </p>
      )}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={open}>
          Open
        </button>
        <button type="button" ref={cancel} className="kern-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
