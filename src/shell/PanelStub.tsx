// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { Folder, Menu } from "lucide-react";
import { currentContext, getAction, runAction } from "../keys/actions";

// Design 4.3: in a document tab each side panel folds to one button on its
// edge. The left one is a folder icon, the right one the three-line icon.
// The button runs the panel toggle action from the table.
export function PanelStub(props: { side: "left" | "right"; expanded: boolean }) {
  const { side, expanded } = props;
  const Icon = side === "left" ? Folder : Menu;
  const label = side === "left" ? "File manager panel" : "Pinned and Recent panel";
  return (
    <div className={`kern-stub kern-stub-${side}`} data-testid={`stub-${side}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        onClick={() => runAction(getAction(`panel.${side}.toggle`), currentContext())}
      >
        <Icon size={20} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
