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
  onGo(path: WirePath): void;
}) {
  const { ancestor } = props;
  return (
    <div className="kern-note" data-testid="gone-banner">
      <FolderX size={30} strokeWidth={1.8} aria-hidden />
      <p className="kern-note-title">This folder is gone</p>
      <p className="kern-note-body">{displayPath(props.path)} no longer exists or has moved.</p>
      {ancestor ? (
        <button type="button" className="kern-button" onClick={() => props.onGo(ancestor)}>
          {displayPath(ancestor)}
        </button>
      ) : (
        <p className="kern-note-body">No folder above it can be read either.</p>
      )}
    </div>
  );
}
