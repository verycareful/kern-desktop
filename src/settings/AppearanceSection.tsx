// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Follow, Settings, ThemeMode } from "../ipc";
import { errorText } from "../ops/error-text";
import { INTERFACE_SIZES } from "../theme/interface-size";
import { useThemeState } from "../theme/theme-state";
import { ACCENT_COLOURS, ACCENTS, fallbackNote } from "./appearance";
import { useSettingsDraft } from "./settings-draft";
import { Choices, Group, Row, Toggle } from "./settings-ui";

// Appearance: the theme mode, the interface size, Kern's 12 accents and the four Follow system
// switches. With a switch on, Kern takes that part from the system (Hyprland, the portal, GTK,
// fontconfig). Only the accent has a pick the system then replaces, so the swatches are disabled
// with the reason; the mode stays Kern's own. The tokens the system gave that fail WCAG AA are
// named, each with a note: Kern uses its own there, and the user should know why their colours
// differ.

const MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SIZES = INTERFACE_SIZES.map((s) => ({ value: s, label: `${s} %` }));

const FOLLOW: readonly {
  key: keyof Follow;
  row: "follow_colours" | "follow_accent" | "follow_fonts" | "follow_radius";
  name: string;
  note: string;
}[] = [
  {
    key: "colours",
    row: "follow_colours",
    name: "colours",
    note: "Hyprland, then the portal, then GTK",
  },
  {
    key: "accent",
    row: "follow_accent",
    name: "accent colour",
    note: "Off: the accent above is used",
  },
  { key: "fonts", row: "follow_fonts", name: "fonts", note: "From fontconfig" },
  { key: "radius", row: "follow_radius", name: "corner radius", note: "From hyprtoolkit.conf" },
];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AppearanceSection(props: { settings: Settings }) {
  const { settings } = props;
  const edit = useSettingsDraft((s) => s.edit);
  const theme = useThemeState((s) => s.theme);
  const problems = useThemeState((s) => s.problems);
  const followingAccent = settings.follow.accent;

  return (
    <>
      <Group rows={["theme"]}>
        <Row id="theme" note="Light or dark">
          <Choices
            label="Theme"
            value={settings.theme_mode}
            options={MODES}
            onChange={(theme_mode) => edit({ theme_mode })}
          />
        </Row>
      </Group>
      <Group rows={["interface_size", "accent"]}>
        <Row id="interface_size" note="The whole interface, every window">
          <Choices
            label="Interface size"
            value={settings.interface_size}
            options={SIZES}
            onChange={(interface_size) => edit({ interface_size })}
          />
        </Row>
        <Row
          id="accent"
          wide
          note={
            followingAccent
              ? "Kern follows your system's accent colour. Turn off Follow the system: Accent colour to choose one here."
              : capital(settings.accent)
          }
        >
          <div className="kern-settings-swatches" role="group" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                className="kern-settings-swatch"
                style={{ background: ACCENT_COLOURS[a] }}
                aria-label={capital(a)}
                aria-pressed={settings.accent === a}
                disabled={followingAccent}
                onClick={() => edit({ accent: a })}
              />
            ))}
          </div>
        </Row>
      </Group>
      <Group rows={FOLLOW.map((f) => f.row)}>
        {FOLLOW.map((f) => (
          <Row key={f.key} id={f.row} note={f.note}>
            <Toggle
              label={`Follow the system: ${f.name}`}
              on={settings.follow[f.key]}
              onChange={(on) => edit({ follow: { [f.key]: on } })}
            />
          </Row>
        ))}
      </Group>
      {theme && theme.fallbacks.length > 0 && (
        <ul className="kern-settings-notes" data-testid="wcag-notes">
          {theme.fallbacks.map((t) => (
            <li key={t}>{fallbackNote(t)}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <details className="kern-settings-notes">
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
    </>
  );
}
