// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { LucideIcon } from "lucide-react";
import { currentContext, getAction, isEnabled, runAction } from "../keys/actions";

/** The tooltip of an action's button: its label, and its first key when it has one. */
function actionTitle(id: string): string {
  const action = getAction(id);
  const key = action.keys[0];
  return key ? `${action.label} (${key})` : action.label;
}

/**
 * An icon button that runs an action of the table, named by the action's label and showing its
 * key on hover. Greyed while the action is not enabled for `targetId` (else the active tab); the
 * caller re-renders it when what decides that changes. `pressed` makes it a toggle.
 */
export function ActionButton(props: {
  id: string;
  icon: LucideIcon;
  targetId?: string;
  pressed?: boolean;
  /** Overrides the action's own enabled state: a pressed view button stays clickable. */
  enabled?: boolean;
  /** Runs after the action, as when the keyboard goes back to the list. */
  after?: () => void;
}) {
  const action = getAction(props.id);
  const Icon = props.icon;
  return (
    <button
      type="button"
      className="kern-icon-button"
      aria-label={action.label}
      aria-pressed={props.pressed}
      title={actionTitle(props.id)}
      disabled={!(props.enabled ?? isEnabled(action, currentContext(props.targetId)))}
      onClick={() => {
        runAction(action, currentContext(props.targetId));
        props.after?.();
      }}
    >
      <Icon size={20} strokeWidth={2} aria-hidden />
    </button>
  );
}
