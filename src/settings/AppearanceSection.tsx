// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId } from "react";
import type { Density, Follow, Settings, ThemeMode } from "../ipc";
import { errorText } from "../ops/error-text";
import { useThemeState } from "../theme/theme-state";
import { ACCENTS, fallbackNote } from "./appearance";
import { useSettings } from "./settings-store";

// Appearance (plan Task 28, design 6.5): the theme mode, Kern's 12 accents,
// the density, and the four Follow system switches. With a switch on, Kern
// takes that part from the system (Hyprland, the portal, GTK, fontconfig) and
// the pick below it is not used, so it is shown disabled with the reason.
// The tokens the system gave that fail WCAG AA are named, each with a note:
// Kern uses its own there, and the user should know why their colours differ.

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Follow the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: "cozy", label: "Cozy" },
  { value: "compact", label: "Compact" },
];

const FOLLOW: { key: keyof Follow; label: string }[] = [
  { key: "colours", label: "Colours" },
  { key: "accent", label: "Accent colour" },
  { key: "fonts", label: "Fonts" },
  { key: "radius", label: "Corner radius" },
];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AppearanceSection(props: { settings: Settings }) {
  const { settings } = props;
  const id = useId();
  const change = useSettings((s) => s.change);
  const theme = useThemeState((s) => s.theme);
  const problems = useThemeState((s) => s.problems);
  const followingAccent = settings.follow.accent;

  return (
    <section className="kern-settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Appearance</h2>

      <fieldset>
        <legend>Theme</legend>
        {MODES.map((m) => (
          <label key={m.value} className="kern-settings-choice">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={settings.theme_mode === m.value}
              onChange={() => void change({ theme_mode: m.value }, "The theme")}
            />
            {m.label}
          </label>
        ))}
      </fieldset>

      <fieldset disabled={followingAccent}>
        <legend>Accent</legend>
        {followingAccent && (
          <p className="kern-settings-note">
            Kern follows your system's accent colour. Turn off Follow system: Accent colour to
            choose one here.
          </p>
        )}
        {ACCENTS.map((a) => (
          <label key={a} className="kern-settings-choice">
            <input
              type="radio"
              name={`${id}-accent`}
              checked={settings.accent === a}
              onChange={() => void change({ accent: a }, "The accent")}
            />
            {capital(a)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Density</legend>
        {DENSITIES.map((d) => (
          <label key={d.value} className="kern-settings-choice">
            <input
              type="radio"
              name={`${id}-density`}
              checked={settings.density === d.value}
              onChange={() => void change({ density: d.value }, "The density")}
            />
            {d.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Follow system</legend>
        {FOLLOW.map((f) => (
          <label key={f.key} className="kern-settings-choice">
            <input
              type="checkbox"
              checked={settings.follow[f.key]}
              onChange={(e) =>
                void change({ follow: { [f.key]: e.target.checked } }, `Follow system: ${f.label}`)
              }
            />
            {f.label}
          </label>
        ))}
      </fieldset>

      {theme && theme.fallbacks.length > 0 && (
        <ul className="kern-settings-notes" data-testid="wcag-notes">
          {theme.fallbacks.map((t) => (
            <li key={t}>{fallbackNote(t)}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <details className="kern-settings-note">
          <summary>
            {problems.length === 1
              ? "1 part of the system theme could not be read"
              : `${problems.length} parts of the system theme could not be read`}
          </summary>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{errorText(p)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
