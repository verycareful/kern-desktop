// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import {
  EVENT_DRAG_FILES,
  EVENT_DRAG_LEAVE,
  EVENT_DRAG_OVER,
  EVENT_DRAG_REFUSAL,
  EVENT_DROP,
  EVENT_DROP_REFUSED,
  dndTarget,
  on,
  pathKey,
  toWireError,
  type EventName,
  type EventPayloads,
  type WirePath,
} from "../ipc";
import { activeTab, useTabs } from "../store/tabs";
import { REASON_NOT_A_FOLDER_TAB, landingAt, sentence, type Landing } from "./dnd";
import { useOps } from "./useOps";

// A drag from another application passing over the window (design 5.8). The backend forwards
// the pointer's position (kern://drag-over) and the page says what is under it: the folder row,
// Places entry or folder view body under the pointer lights up and the backend is told which
// folder it is, so the pointer can show what Kern will do there; any other place lights nothing
// and the reason is shown. The drop itself is carried out by the folder view (FolderView.tsx);
// what is said here is why a drop did not happen.

const LIT = "kern-drop-over";

export function DropHover() {
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const offs: Array<() => void> = [];
    // The drag in progress and what is known about it.
    const st = {
      drag: null as number | null,
      sources: null as WirePath[] | null,
      lit: null as Element | null,
      // What the backend was last told about the place, so it is told when that changes.
      answered: null as string | null,
      // Why the place under the pointer takes nothing, and why the backend declines the drag.
      place: null as string | null,
      declined: null as string | null,
    };
    const light = (el: Element | null) => {
      if (el === st.lit) return;
      st.lit?.classList.remove(LIT);
      st.lit = el;
      el?.classList.add(LIT);
    };
    const show = () => setHint(st.place ?? st.declined);
    const forgetPlace = () => {
      light(null);
      st.answered = null;
      st.place = null;
      st.declined = null;
      setHint(null);
    };
    const begin = (drag: number) => {
      if (st.drag === drag) return;
      st.drag = drag;
      st.sources = null;
      forgetPlace();
    };
    const resolve = (
      position: { x: number; y: number },
      view: { width: number; height: number },
      sources: WirePath[] | null
    ): Landing => {
      if (activeTab(useTabs.getState())?.kind !== "folder") {
        return { ok: false, reason: REASON_NOT_A_FOLDER_TAB };
      }
      return landingAt(
        position,
        view,
        { width: window.innerWidth, height: window.innerHeight },
        sources
      );
    };
    const fail = (e: unknown) => {
      if (live) useOps.getState().report({ title: "Drop", report: null, error: toWireError(e) });
    };
    const subscribe = <E extends EventName>(name: E, handler: (e: EventPayloads[E]) => void) => {
      on(name, handler).then(
        (off) => (live ? offs.push(off) : off()),
        (e: unknown) => fail(e)
      );
    };

    subscribe(EVENT_DRAG_FILES, (e) => {
      begin(e.drag);
      st.sources = e.paths;
    });
    subscribe(EVENT_DRAG_OVER, (e) => {
      begin(e.drag);
      const landing = resolve(e.position, e.view, st.sources);
      light(landing.ok ? landing.el : null);
      st.place = landing.ok ? null : sentence(landing.reason);
      show();
      const key = landing.ok ? `folder:${pathKey(landing.path)}` : `refused:${landing.reason}`;
      if (key === st.answered) return;
      st.answered = key;
      dndTarget(
        e.drag,
        landing.ok
          ? { state: "folder", path: landing.path }
          : { state: "refused", reason: sentence(landing.reason) }
      ).catch(fail);
    });
    subscribe(EVENT_DRAG_REFUSAL, (e) => {
      if (e.drag !== st.drag) return;
      st.declined = e.refusal === null ? null : sentence(e.refusal);
      show();
    });
    subscribe(EVENT_DRAG_LEAVE, (e) => {
      if (e.drag === st.drag) forgetPlace();
    });
    subscribe(EVENT_DROP_REFUSED, (e) => {
      st.drag = null;
      forgetPlace();
      useOps.getState().notify(sentence(e.reason));
    });
    subscribe(EVENT_DROP, (e) => {
      st.drag = null;
      forgetPlace();
      const landing = resolve(e.position, e.view, e.paths);
      if (!landing.ok) useOps.getState().notify(sentence(landing.reason));
    });
    return () => {
      live = false;
      light(null);
      for (const off of offs) off();
    };
  }, []);
  return hint === null ? null : (
    <p role="status" className="kern-drop-hint">
      {hint}
    </p>
  );
}
