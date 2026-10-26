// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { displayPath, listDir, toWireError, userDirs, type WirePath } from "../ipc";
import { parseLocation } from "./path-input";

// The typed location (Ctrl+L, design 5.1). Enter checks that the folder lists
// and only then navigates; whatever is wrong is shown here and the bar stays
// open. Escape closes it without going anywhere.
export function LocationBar(props: {
  path: WirePath;
  onNavigate(path: WirePath): void;
  onClose(): void;
}) {
  const [text, setText] = useState(() => displayPath(props.path));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    input.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      // The Home folder is only needed for ~, so it is looked up only then.
      const home = text.trim().startsWith("~") ? (await userDirs()).home : null;
      const parsed = parseLocation(text, home);
      if (!parsed.ok) {
        if (alive.current) setError(parsed.message);
        return;
      }
      await listDir(parsed.path, false);
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
        onChange={(e) => setText(e.target.value)}
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
