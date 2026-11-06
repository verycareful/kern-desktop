// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { Folder, Menu } from "lucide-react";
import { currentContext, getAction, runAction } from "../keys/actions";
import { usePanels } from "../store/panels";
import { useLayout } from "../store/layout";

/**
 * The button on the tab row that shows or hides a side panel: the folder icon at the start of the
 * row for the left one (the file manager panel beside a document, the folder column of the editor
 * layout), the three-line icon beside Settings for Pinned and Recent. It runs the panel's action
 * from the table and is lit while its panel is open.
 */
export function PanelToggle(props: { side: "left" | "right" }) {
  const { side } = props;
  const { leftOpen, rightOpen } = usePanels();
  const editorLayout = useLayout((s) => s.layout === "editor");
  const action = getAction(`panel.${side}.toggle`);
  const Icon = side === "left" ? Folder : Menu;
  const label =
    side === "right"
      ? "Pinned and Recent panel"
      : editorLayout
        ? "Folder column"
        : "File manager panel";
  const key = action.keys[0];
  return (
    <button
      type="button"
      className="kern-icon-button kern-panel-toggle"
      data-testid={`panel-toggle-${side}`}
      aria-label={label}
      aria-expanded={side === "left" ? leftOpen : rightOpen}
      title={key ? `${action.label} (${key})` : action.label}
      onClick={() => runAction(action, currentContext())}
    >
      <Icon size={20} strokeWidth={2} aria-hidden />
    </button>
  );
}
