// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Above a PDF whose file is no longer the one that was opened or saved: changed by another
// program, or deleted. Saving never writes over a changed file without being told to; a deleted one
// says that saving creates it again. Reload names what it throws away while there are unsaved
// changes.
export function PdfChangedBanner(props: {
  kind: "changed" | "gone";
  dirty: boolean;
  onReload(): void;
  onSaveAs(): void;
}) {
  const gone = props.kind === "gone";
  return (
    <div
      className="kern-doc-banner"
      role="alert"
      data-testid={gone ? "pdf-gone-banner" : "pdf-changed-banner"}
    >
      <p>
        {gone
          ? "This file was deleted from the disk. The PDF is still open here; saving creates the file again."
          : "This file was changed on the disk by another program. Saving would replace those changes."}
      </p>
      <span className="kern-doc-banner-actions">
        {!gone && (
          <button type="button" className="kern-button" onClick={props.onReload}>
            {props.dirty ? "Discard my changes and reload" : "Reload"}
          </button>
        )}
        <button type="button" className="kern-button" onClick={props.onSaveAs}>
          Save As…
        </button>
      </span>
    </div>
  );
}
