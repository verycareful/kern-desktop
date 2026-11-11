// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { X } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { bindsClear, bindsSet, toWireError, type BindsPatch, type Settings } from "../ipc";
import { actions, candidateKeys, getAction, type Action } from "../keys/actions";
import {
  applyBinds,
  bindsOf,
  eventToMouseBind,
  loadBinds,
  refusedBind,
  useBinds,
  useBindsSync,
} from "../keys/binds";
import { logError } from "../ops/error-log";
import { errorText } from "../ops/error-text";
import { RepeatFlash } from "../ops/repeat-flash";
import { useRaisedText } from "../ops/raised-text";
import { ClearList } from "./ClearList";
import { areasOf, holdersOf, matchesQuery, WHERE } from "./keys-model";
import { SettingsQuery } from "./settings-query";
import { searching } from "./settings-search";
import { Group, Row } from "./settings-ui";

// The Keys and mouse category: every action of the table with the keys and mouse buttons that
// run it. A bind is added by pressing the key or clicking the button, removed with its x, and an
// action goes back to its defaults with Reset. Unlike the other categories the changes are stored
// at once, not at Save: the binds are a file of their own (store.rs Binds), and every window
// follows them as they change. A bind another action holds in the same place is asked about
// before it is taken, and the move is one write.

const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Control", "Alt", "Shift", "Meta"]);

/** The message under an action: what it asks, or why a bind was not added. */
type Say =
  | { id: string; kind: "ask"; bind: string; holders: Action[] }
  | { id: string; kind: "no"; text: string };

export function KeysSection(_props: { settings: Settings }) {
  useBindsSync();
  const overrides = useBinds((s) => s.overrides);
  const loaded = useBinds((s) => s.loaded);
  const loadError = useBinds((s) => s.error);
  const query = useContext(SettingsQuery);
  const [filter, setFilter] = useState("");
  const [capturing, setCapturing] = useState<string | null>(null);
  const [say, setSay] = useState<Say | null>(null);
  const problem = useRaisedText();
  /** The action whose Add button takes the focus back when the capture ends. */
  const refocus = useRef<string | null>(null);

  const write = async (patch: BindsPatch): Promise<void> => {
    try {
      applyBinds(await bindsSet(patch));
      problem.clear();
    } catch (e) {
      const text = `The binds could not be saved: ${errorText(toWireError(e))}`;
      problem.raise(text);
      logError("binds", text);
    }
  };

  const offer = (id: string, bind: string) => {
    const me = getAction(id);
    const have = bindsOf(me, overrides);
    setCapturing(null);
    if (have.includes(bind)) {
      setSay({ id, kind: "no", text: `${me.label} already has ${bind}.` });
      return;
    }
    const holders = holdersOf(bind, me, overrides);
    if (holders.length > 0) {
      setSay({ id, kind: "ask", bind, holders });
      return;
    }
    setSay(null);
    void write({ [id]: [...have, bind] });
  };

  const take = (id: string, bind: string, holders: Action[]) => {
    const patch: BindsPatch = { [id]: [...bindsOf(getAction(id), overrides), bind] };
    for (const h of holders) patch[h.id] = bindsOf(h, overrides).filter((b) => b !== bind);
    setSay(null);
    void write(patch);
  };

  // While an action waits for a bind, the next key or mouse button is the bind: the window's own
  // reading of it is stopped, so Ctrl+W does not close the window it is being chosen in.
  useEffect(() => {
    if (capturing === null) return;
    const id = capturing;
    const onKey = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (e.key === "Escape" && bare) setCapturing(null);
      else offer(id, candidateKeys(e)[0]!);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-capture-cancel]")) return;
      e.preventDefault();
      e.stopPropagation();
      const bind = eventToMouseBind(e);
      const why = bind === null ? "That mouse button has no name here." : refusedBind(bind);
      if (bind === null || why !== null) setSay({ id, kind: "no", text: why! });
      else offer(id, bind);
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("contextmenu", noMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("contextmenu", noMenu, true);
    };
    // `offer` reads the binds of this render.
  }, [capturing, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (capturing !== null || refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-add-for="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  }, [capturing]);

  const words = searching(query) ? query : filter;
  const shown = useMemo(
    () => areasOf(actions.filter((a) => matchesQuery(a, overrides, words))),
    [overrides, words]
  );

  return (
    <>
      {loadError && (
        <div role="alert" className="kern-banner">
          Your key and mouse binds could not be read: {errorText(loadError)}. The default binds are
          in use. <RepeatFlash watch={loadError} />{" "}
          <button type="button" className="kern-button" onClick={() => void loadBinds()}>
            Retry
          </button>
        </div>
      )}
      {problem.text && (
        <div role="alert" className="kern-banner">
          {problem.text} <RepeatFlash watch={problem.repeats} />
        </div>
      )}
      {!loaded && !loadError && <p role="status">Reading your binds…</p>}
      <Group rows={["keys_list"]}>
        <Row
          id="keys_list"
          wide
          note="Add a bind, then press the key or click the mouse button. A bind can be a key, a mouse button, or either with Ctrl, Alt, Shift or Meta held. Changing one here replaces that action's default binds."
        >
          <input
            type="search"
            className="kern-modal-input"
            aria-label="Filter actions"
            placeholder="Filter actions by name, place or bind"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Row>
      </Group>
      {shown.length === 0 && (
        <p role="status" className="kern-settings-hint">
          No action matches “{words.trim()}”.
        </p>
      )}
      {shown.map((g) => (
        <section key={g.area} className="kern-settings-group" aria-label={g.area}>
          <h3 className="kern-settings-group-title">{g.area}</h3>
          <div className="kern-settings-card">
            {g.actions.map((a) => (
              <ActionRow
                key={a.id}
                action={a}
                binds={bindsOf(a, overrides)}
                changed={overrides[a.id] !== undefined}
                capturing={capturing === a.id}
                busy={capturing !== null}
                say={say?.id === a.id ? say : null}
                onAdd={() => {
                  setSay(null);
                  refocus.current = a.id;
                  setCapturing(a.id);
                }}
                onCancel={() => setCapturing(null)}
                onRemove={(bind) =>
                  void write({ [a.id]: bindsOf(a, overrides).filter((b) => b !== bind) })
                }
                onReset={() => void write({ [a.id]: null })}
                onTake={(bind, holders) => take(a.id, bind, holders)}
                onKeep={() => setSay(null)}
              />
            ))}
          </div>
        </section>
      ))}
      <Group rows={["reset_binds"]}>
        <ClearList
          id="reset_binds"
          note="Deletes every bind you set, in every window. Every action goes back to its default keys and mouse buttons."
          button="Reset all binds"
          title="Reset all binds?"
          text="Every key and mouse button you set is removed and each action goes back to its defaults. The binds in the file are deleted; this cannot be undone."
          done="Every bind is back to its default."
          failed="The binds could not be reset"
          clear={async () => applyBinds(await bindsClear())}
        />
      </Group>
    </>
  );
}

function ActionRow(props: {
  action: Action;
  binds: string[];
  changed: boolean;
  capturing: boolean;
  busy: boolean;
  say: Say | null;
  onAdd(): void;
  onCancel(): void;
  onRemove(bind: string): void;
  onReset(): void;
  onTake(bind: string, holders: Action[]): void;
  onKeep(): void;
}) {
  const { action: a, binds, say } = props;
  return (
    <div
      role="group"
      aria-label={a.label}
      className="kern-settings-row kern-bind-row"
      data-action={a.id}
    >
      <div className="kern-settings-label">
        <b>{a.label}</b>
        <span>{WHERE[a.when]}</span>
      </div>
      <div className="kern-bind-controls">
        {binds.length === 0 ? (
          <span className="kern-settings-hint">No bind</span>
        ) : (
          <ul className="kern-bind-list" aria-label={`Binds of ${a.label}`}>
            {binds.map((b) => (
              <li key={b} className="kern-bind">
                <kbd>{b}</kbd>
                <button
                  type="button"
                  className="kern-bind-remove"
                  aria-label={`Remove ${b} from ${a.label}`}
                  onClick={() => props.onRemove(b)}
                >
                  <X size={12} strokeWidth={2} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.changed && <span className="kern-bind-changed">Changed</span>}
        <button
          type="button"
          className="kern-button"
          data-add-for={a.id}
          aria-label={`Add a bind to ${a.label}`}
          disabled={props.busy}
          onClick={props.onAdd}
        >
          Add
        </button>
        {props.changed && (
          <button
            type="button"
            className="kern-button"
            aria-label={`Reset ${a.label}`}
            disabled={props.busy}
            onClick={props.onReset}
          >
            Reset
          </button>
        )}
      </div>
      {props.capturing && (
        <p role="status" className="kern-bind-say">
          Press a key or click a mouse button. Escape cancels.{" "}
          <button
            type="button"
            className="kern-button"
            data-capture-cancel
            onClick={props.onCancel}
          >
            Cancel
          </button>
        </p>
      )}
      {say?.kind === "no" && (
        <p role="alert" className="kern-bind-say kern-modal-error">
          {say.text}
        </p>
      )}
      {say?.kind === "ask" && (
        <p role="alert" className="kern-bind-say">
          {say.bind} is {say.holders.map((h) => h.label).join(" and ")}&apos;s bind. Take it for{" "}
          {a.label}?{" "}
          <button
            type="button"
            className="kern-button"
            onClick={() => props.onTake(say.bind, say.holders)}
          >
            Take it
          </button>{" "}
          <button type="button" className="kern-button" onClick={props.onKeep}>
            Keep it
          </button>
        </p>
      )}
    </div>
  );
}
