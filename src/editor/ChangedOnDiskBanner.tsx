// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Above a document whose file is no longer the one that was opened or saved:
// changed by another program, or deleted (design 4.3; review focus 3). A
// deleted file says that saving creates it again; a changed one offers Reload,
// which names what it throws away while there are unsaved edits.
export function ChangedOnDiskBanner(props: {
  kind: "changed" | "deleted";
  dirty: boolean;
  onReload(): void;
  onSaveAs(): void;
}) {
  const deleted = props.kind === "deleted";
  return (
    <div
      className="kern-doc-banner"
      role="alert"
      data-testid={deleted ? "deleted-banner" : "changed-banner"}
    >
      <p>
        {deleted
          ? "This file was deleted from the disk. Your text is still here; saving creates the file again."
          : "This file was changed on the disk by another program. Saving would replace those changes."}
      </p>
      <span className="kern-doc-banner-actions">
        {!deleted && (
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
