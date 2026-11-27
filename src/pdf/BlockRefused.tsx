// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import type { Rect } from "../ipc/pdf";
import { refusalText } from "./block-edit";
import { percent } from "./percent";

// Where the box may stand, as a fraction of the page, so it stays on the page.
const BOX_MAX_TOP = 0.85;

// What a block that cannot be edited says when it is chosen: why, in plain words. Escape or the
// button lets it go.
export function BlockRefused(props: {
  /** The block, as fractions of the page. */
  rect: Rect;
  /** The engine's name for why it cannot be edited. */
  reason: string | undefined;
  onClose(): void;
}) {
  const { rect, reason, onClose } = props;
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => close.current?.focus(), []);

  return (
    <div
      className="kern-pdf-note-editor kern-pdf-block-refused"
      role="dialog"
      aria-label="Text that cannot be edited"
      style={{ left: percent(rect[0]), top: percent(Math.min(rect[3], BOX_MAX_TOP)) }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="kern-pdf-annotation-text">{refusalText(reason)}</p>
      <div className="kern-pdf-note-buttons">
        <button ref={close} type="button" className="kern-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
