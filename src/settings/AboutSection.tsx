// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useState } from "react";
import { openUrl, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { LICENCE_TEXT } from "./licence";
import { useSettings } from "./settings-store";
import { VERSION_LABEL } from "./version";

// About: the version label, the licence, and links to Kern's
// source and to the Android app. A link is opened by the default application
// for https links (kernkraft open_url); Kern itself connects to nothing.

const LINKS = [
  { label: "Source code", url: "https://github.com/verycareful/kern-desktop" },
  { label: "Kern for Android", url: "https://github.com/verycareful/kern" },
] as const;

export function AboutSection() {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  // The settings view shows About only once the settings are read.
  const terminal = useSettings((s) => s.settings?.terminal ?? null);

  const open = async (url: string) => {
    setError(null);
    try {
      await openUrl(url, terminal ?? undefined);
    } catch (e) {
      setError(`${url} could not be opened: ${errorText(toWireError(e))}`);
    }
  };

  return (
    <section className="kern-settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>About</h2>
      <p data-testid="about-version">Kern {VERSION_LABEL}</p>
      <p>
        Free software under the GNU Affero General Public License, version 3 or later. Copyright
        2026 Sricharan Suresh.
      </p>
      <ul className="kern-settings-list">
        {LINKS.map((l) => (
          <li key={l.url}>
            <button type="button" className="kern-button" onClick={() => void open(l.url)}>
              {l.label}
            </button>
            <span className="kern-settings-url">{l.url}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
      <details>
        <summary>Licence</summary>
        <pre className="kern-settings-licence" data-testid="licence-text">
          {LICENCE_TEXT}
        </pre>
      </details>
    </section>
  );
}
