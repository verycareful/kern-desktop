// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { actions, overlaps, type Action } from "../keys/actions";
import { bindsOf, isMouseBind } from "../keys/binds";

// What the Keys section of the Settings window works out from the action table and the user's
// binds: where an action is in force, who holds a bind, how the list is grouped and filtered.

/** Where an action is in force, in words. */
export const WHERE: Record<Action["when"], string> = {
  any: "Anywhere",
  folder: "Folder tabs",
  doc: "Documents",
  trash: "Trash",
  documents: "Library",
  volume: "Places and volumes",
  entry: "Pinned and recent",
  tree: "Folder tree",
};

/** A mouse bind of an action that answers over a tab is not one of the window's. */
const scopeOf = (a: Action): string => a.mouseOn ?? "window";

/**
 * The actions other than `me` that hold `bind` in a place where `me` is also in force: giving
 * `bind` to `me` as well would make a key or button that has two meanings.
 */
export function holdersOf(
  bind: string,
  me: Action,
  overrides: Record<string, string[]>,
  list: readonly Action[] = actions
): Action[] {
  return list.filter(
    (o) =>
      o.id !== me.id &&
      bindsOf(o, overrides).includes(bind) &&
      overlaps(o.when, me.when) &&
      !(isMouseBind(bind) && scopeOf(o) !== scopeOf(me))
  );
}

/** The actions grouped by menu area, in table order. */
export function areasOf(list: readonly Action[]): { area: Action["area"]; actions: Action[] }[] {
  const groups: { area: Action["area"]; actions: Action[] }[] = [];
  for (const a of list) {
    const group = groups.find((g) => g.area === a.area);
    if (group) group.actions.push(a);
    else groups.push({ area: a.area, actions: [a] });
  }
  return groups;
}

/** Whether every word of `query` is part of the action's name, area, place or current binds. */
export function matchesQuery(
  a: Action,
  overrides: Record<string, string[]>,
  query: string
): boolean {
  const text =
    `${a.label} ${a.area} ${WHERE[a.when]} ${bindsOf(a, overrides).join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}
