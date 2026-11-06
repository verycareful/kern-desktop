// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useThemeState } from "../theme/theme-state";

// Kern's logo at the top of the places strip: the mark and the "kern"
// wordmark, as the design handoff draws the browser header (README, Header
// row: mark 26 px, wordmark Quicksand 21/700). A press runs `onOpen`: the places strip opens
// Settings at About with it, the Settings window, whose sidebar ends with it, shows About. The brand colours are the handoff's (README, Brand mark / lockup):
// deep navy on a light surface, light grey on a dark one; they follow the
// scheme and are never taken from the system theme.

const NAVY = "#0B1437";
const LIGHT = "#E7E7EC";

/**
 * The mark: a field with a chevron notch cut from its right side, forming a "k". The points are
 * the handoff lockup's (brand/logo-lockup-navy.png, 950 by 1182 for the mark), so the notch meets
 * the right edge at the top and bottom corners and reaches 360 in at mid height.
 */
const MARK_POINTS = "0,0 950,0 360,591 950,1182 0,1182";

/** The scheme on show: the applied theme's, or the system's before the first theme arrives. */
function useDark(): boolean {
  const scheme = useThemeState((s) => s.theme?.tokens.scheme);
  if (scheme) return scheme === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function KernLogo(props: { onOpen: () => void; version?: string }) {
  const colour = useDark() ? LIGHT : NAVY;
  return (
    <button
      type="button"
      className="kern-logo"
      aria-label="About Kern"
      title="About Kern"
      style={{ color: colour }}
      onClick={props.onOpen}
    >
      <svg className="kern-logo-mark" viewBox="0 0 950 1182" aria-hidden>
        <polygon points={MARK_POINTS} fill="currentColor" />
      </svg>
      <span className="kern-logo-word" aria-hidden>
        kern
      </span>
      {props.version && <span className="kern-logo-version">{props.version}</span>}
    </button>
  );
}
