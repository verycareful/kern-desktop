// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useContext, useId, type ReactNode } from "react";
import { SettingsQuery } from "./settings-query";
import { ROWS, rowMatches, type RowId } from "./settings-search";

// The pieces every category of the Settings window is made of: a group of rows in a card, a row
// (its label, a note under it and its control on the right), an on/off switch and a row of
// choices. A row the search does not find is left out, and so is a group none of whose rows it
// finds.

export function Group(props: { rows: readonly RowId[]; children: ReactNode }) {
  const query = useContext(SettingsQuery);
  const shown = props.rows.filter((r) => rowMatches(r, query));
  if (shown.length === 0) return null;
  const title = ROWS[shown[0]!].group;
  return (
    <section className="kern-settings-group" aria-label={title}>
      <h3 className="kern-settings-group-title">{title}</h3>
      <div className="kern-settings-card">{props.children}</div>
    </section>
  );
}

/** A row; `wide` puts the control under the label, for one that takes the whole width. */
export function Row(props: {
  id: RowId;
  note?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
  /** The id the control's label points at, for a control that is a form field. */
  htmlFor?: string;
}) {
  const query = useContext(SettingsQuery);
  if (!rowMatches(props.id, query)) return null;
  const label = ROWS[props.id].label;
  return (
    <div
      className={props.wide ? "kern-settings-row kern-settings-row-wide" : "kern-settings-row"}
      data-row={props.id}
    >
      <div className="kern-settings-label">
        {props.htmlFor ? <label htmlFor={props.htmlFor}>{label}</label> : <b>{label}</b>}
        {props.note && <span>{props.note}</span>}
      </div>
      {props.children}
    </div>
  );
}

/**
 * A row that is itself the control: pressing anywhere on it runs `onPress` (a link, a dialog).
 * Its name is the row's label; the note describes it; `trail` sits on the right (a value, an
 * icon).
 */
export function RowButton(props: {
  id: RowId;
  note?: ReactNode;
  trail?: ReactNode;
  onPress(): void;
}) {
  const query = useContext(SettingsQuery);
  const noteId = useId();
  if (!rowMatches(props.id, query)) return null;
  return (
    <button
      type="button"
      className="kern-settings-row kern-settings-row-button"
      data-row={props.id}
      aria-label={ROWS[props.id].label}
      aria-describedby={props.note ? noteId : undefined}
      onClick={props.onPress}
    >
      <span className="kern-settings-label">
        <b>{ROWS[props.id].label}</b>
        {props.note && <span id={noteId}>{props.note}</span>}
      </span>
      {props.trail && <span className="kern-settings-trail">{props.trail}</span>}
    </button>
  );
}

export function Toggle(props: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="kern-settings-switch"
      aria-label={props.label}
      aria-checked={props.on}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

export function Choices<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <div className="kern-settings-choices" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
