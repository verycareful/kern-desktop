// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfAnnotation, Rgb } from "../ipc/pdf";
import { PALETTE, cssColour, isNote, kindLabel, sameColour } from "./annotations";
import { percent } from "./percent";

// Where the menu may stand, as fractions of the page, so it stays on the page.
const MENU_MAX_LEFT = 0.6;
const MENU_MAX_TOP = 0.9;

// What can be done with the annotation that is picked: its colour, the text of a note, and taking
// it away. The buttons are off while the document cannot be changed.
export function AnnotationMenu(props: {
  annotation: PdfAnnotation;
  canEdit: boolean;
  onColour(colour: Rgb): void;
  onEditText(): void;
  onDelete(): void;
}) {
  const { annotation, canEdit } = props;
  const [left, , , bottom] = annotation.rect;
  return (
    <div
      className="kern-pdf-annotation-menu"
      role="toolbar"
      aria-label={kindLabel(annotation)}
      style={{
        left: percent(Math.min(left, MENU_MAX_LEFT)),
        top: percent(Math.min(bottom, MENU_MAX_TOP)),
      }}
      // A press on the menu is the menu's, not a press on the page under it.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isNote(annotation) && annotation.contents && (
        <p className="kern-pdf-annotation-text">{annotation.contents}</p>
      )}
      <div className="kern-pdf-annotation-buttons">
        {PALETTE.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            className="kern-pdf-swatch"
            aria-label={swatch.name}
            aria-pressed={annotation.colour ? sameColour(annotation.colour, swatch.rgb) : false}
            style={{ background: cssColour(swatch.rgb) }}
            disabled={!canEdit}
            onClick={() => props.onColour(swatch.rgb)}
          />
        ))}
        {isNote(annotation) && (
          <button
            type="button"
            className="kern-button"
            disabled={!canEdit}
            onClick={props.onEditText}
          >
            Edit text
          </button>
        )}
        <button type="button" className="kern-button" disabled={!canEdit} onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
