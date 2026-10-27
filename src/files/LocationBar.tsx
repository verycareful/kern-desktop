// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { displayPath, toWireError, userDirs, type WirePath } from "../ipc";
import { parseLocation } from "./path-input";

// The typed location (Ctrl+L, design 5.1). Enter checks the text and navigates;
// whatever is wrong with the text is shown here and the bar stays open. Whether
// the folder exists is for the folder view to say: it lists the folder anyway,
// and shows the error or the missing-folder banner. Escape closes the bar
// without going anywhere. Text left as it was shown keeps the path it came
// from, so a folder whose name is not UTF-8 is not turned into another path.
export function LocationBar(props: {
  path: WirePath;
  /** Text to show instead of the path (a bar reopened with what was typed). */
  initialText?: string;
  /** Every change to the text, so the view can keep it. */
  onText?(text: string): void;
  onNavigate(path: WirePath): void;
  onClose(): void;
}) {
  const [initial] = useState(() => displayPath(props.path));
  const [resumed] = useState(props.initialText);
  const [text, setText] = useState(resumed ?? initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    if (resumed === undefined) input.current?.select();
    // Typed text is continued, not replaced by the next key.
    else input.current?.setSelectionRange(resumed.length, resumed.length);
    return () => {
      alive.current = false;
    };
  }, [resumed]);

  const submit = async () => {
    setError(null);
    if (text === initial) {
      props.onNavigate(props.path);
      props.onClose();
      return;
    }
    setBusy(true);
    try {
      // The Home folder is only needed for ~, so it is looked up only then.
      const home = text.startsWith("~") ? (await userDirs()).home : null;
      const parsed = parseLocation(text, home);
      if (!parsed.ok) {
        if (alive.current) setError(parsed.message);
        return;
      }
      if (!alive.current) return;
      props.onNavigate(parsed.path);
      props.onClose();
    } catch (e) {
      const err = toWireError(e);
      if (alive.current) setError(`${err.kind}: ${err.message}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="kern-location">
      <input
        ref={input}
        type="text"
        aria-label="Location"
        aria-invalid={error !== null}
        spellCheck={false}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          props.onText?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          }
        }}
      />
      {error && (
        <p role="alert" className="kern-location-error">
          {error}
        </p>
      )}
    </div>
  );
}
