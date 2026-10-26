// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import {
  EVENT_THEME_CHANGED,
  on,
  settingsGet,
  themeGet,
  toWireError,
  type Follow,
  type UnlistenFn,
  type UserChoice,
  type WireError,
  type WireTheme,
} from "../ipc";

// Applies the system theme (parent spec 6.5, design 7.1): kernkraft-theme
// resolves it, the backend sends it as CSS custom properties, and this hook
// keeps them in one <style id="kern-tokens"> element, replaced in place on
// every update and on every kernkraft://theme-changed event.
//
// Until the first payload arrives, and for good if theme_get fails, the page
// shows the tokens Kern ships in base.css (Kern's own neutrals and Slate
// accent from the design handoff). That fallback is visible, never silent:
// the failure is returned as `error` for the caller to show.

export interface ThemePrefs {
  follow: Follow;
  user: UserChoice;
}

export interface ThemeState {
  /** The last theme applied, or null before the first one. */
  theme: WireTheme | null;
  /** Why no theme was applied (or its updates stopped), or null. */
  error: WireError | null;
}

const STYLE_ID = "kern-tokens";

function writeTokens(css: string): void {
  let el = document.head.querySelector<HTMLStyleElement>(`style#${STYLE_ID}`);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * With `prefs`, the theme is resolved with them. Without, with the stored
 * settings, which is what the app wants at startup: theme_get makes its
 * arguments the preferences later events are resolved with, so the defaults
 * must never stand in for the user's choice.
 */
export function useTheme(prefs?: ThemePrefs): ThemeState {
  const [state, setState] = useState<ThemeState>({ theme: null, error: null });
  const key = prefs ? JSON.stringify(prefs) : "";

  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | undefined;
    const apply = (theme: WireTheme) => {
      if (!alive) return;
      writeTokens(theme.css);
      setState({ theme, error: null });
    };
    const fail = (e: unknown) => {
      if (alive) setState((s) => ({ ...s, error: toWireError(e) }));
    };

    void (async () => {
      try {
        // Subscribed before the first request, so a change between the two
        // is not lost.
        const off = await on(EVENT_THEME_CHANGED, apply);
        if (alive) unlisten = off;
        else off();

        let resolved: ThemePrefs;
        if (key) {
          resolved = JSON.parse(key) as ThemePrefs;
        } else {
          const s = await settingsGet();
          resolved = {
            follow: s.follow,
            user: { mode: s.theme_mode, accent: s.accent, density: s.density },
          };
        }
        apply(await themeGet(resolved.follow, resolved.user));
      } catch (e) {
        fail(e);
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [key]);

  return state;
}
