// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn((_name: string, _handler: unknown, _options?: unknown) =>
  Promise.resolve(() => undefined)
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown, options?: unknown) => listen(name, handler, options),
}));

import { EVENT_CLOSE_REQUESTED, on } from "./events";

type Internals = { __TAURI_INTERNALS__?: unknown };

function setLabel(label: string | null) {
  const w = window as Internals;
  if (label === null) delete w.__TAURI_INTERNALS__;
  else w.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label } } };
}

afterEach(() => {
  setLabel(null);
  listen.mockClear();
});

describe("on", () => {
  // Tauri delivers an event emitted to one label to every listener whose
  // target is `Any`; a window that listened that way would act on another
  // window's close request.
  it("listens only to the events of its own window", async () => {
    setLabel("editor-2");
    await on(EVENT_CLOSE_REQUESTED, () => undefined);
    expect(listen).toHaveBeenCalledWith(EVENT_CLOSE_REQUESTED, expect.any(Function), {
      target: "editor-2",
    });
  });

  it("listens unscoped in the browser preview, which has no window", async () => {
    setLabel(null);
    await on(EVENT_CLOSE_REQUESTED, () => undefined);
    expect(listen).toHaveBeenCalledWith(EVENT_CLOSE_REQUESTED, expect.any(Function), undefined);
  });

  it("hands the handler the payload itself", async () => {
    setLabel("main");
    const got: unknown[] = [];
    await on("kern://doc-released", (p) => got.push(p));
    const wrapped = listen.mock.calls[0]![1] as (e: { payload: unknown }) => void;
    wrapped({ payload: null });
    expect(got).toEqual([null]);
  });
});
