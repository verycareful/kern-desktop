// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { FolderX } from "lucide-react";
import { displayPath, type WirePath } from "../ipc";

// Shown in place of the list when the folder has been removed or moved away.
// It offers the nearest folder above that still exists; it never goes there
// on its own.
export function GoneBanner(props: {
  path: WirePath;
  ancestor: WirePath | null;
  /** True while the nearest existing folder is still being looked for. */
  searching: boolean;
  onGo(path: WirePath): void;
}) {
  const { ancestor } = props;
  return (
    <div className="kern-note" data-testid="gone-banner">
      <FolderX size={30} strokeWidth={1.8} aria-hidden />
      <p className="kern-note-title">This folder does not exist</p>
      <p className="kern-note-body">
        {displayPath(props.path)} is not there: it was never there, or it has been removed or moved.
      </p>
      {props.searching ? (
        <p className="kern-note-body" role="status">
          Looking for the nearest folder that exists…
        </p>
      ) : ancestor ? (
        <button type="button" className="kern-button" onClick={() => props.onGo(ancestor)}>
          {displayPath(ancestor)}
        </button>
      ) : (
        <p className="kern-note-body">No folder above it can be read either.</p>
      )}
    </div>
  );
}
