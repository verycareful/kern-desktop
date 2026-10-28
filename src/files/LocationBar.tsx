// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { displayPath, toWireError, userDirs, type WirePath } from "../ipc";
import { parseLocation } from "./path-input";

// The typed location (Ctrl+L, design 5.1). Enter checks the text and navigates;
// whatever is wrong with the text is shown here and the bar stays open. Whether
// the folder exists is for the folder view to say: it lists the folder anyway,
// and shows the error or the missing-folder banner. The bar closes without going
// anywhere on Escape, and when focus leaves it for something else in Kern (a
// click elsewhere), dropping what was typed. Focus leaving Kern's window
// (Alt+Tab, another application) leaves the bar and its text as they were; the
// next blur inside Kern or Escape closes it. A check under way is let finish:
// leaving then neither closes the bar nor loses the error, and a check that
// succeeds goes on to close it, as a blur when focus had left meanwhile so that
// the list does not take the keyboard back. Text left as it was shown keeps the
// path it came from, so a folder whose name is not UTF-8 is not turned into
// another path.
export function LocationBar(props: {
  path: WirePath;
  onNavigate(path: WirePath): void;
  /** "done" is Enter or Escape, after which the keyboard belongs to the list; "blur" is focus leaving. */
  onClose(how: "done" | "blur"): void;
}) {
  const [initial] = useState(() => displayPath(props.path));
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const checking = useRef(false);
  const leftDuringCheck = useRef(false);
  const closed = useRef(false);

  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    input.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  // Closing is announced once, whichever of Enter, Escape and blur comes first.
  const close = (how: "done" | "blur") => {
    if (closed.current) return;
    closed.current = true;
    props.onClose(how);
  };

  const submit = async () => {
    setError(null);
    if (text === initial) {
      props.onNavigate(props.path);
      close("done");
      return;
    }
    checking.current = true;
    leftDuringCheck.current = false;
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
      close(leftDuringCheck.current ? "blur" : "done");
    } catch (e) {
      const err = toWireError(e);
      if (alive.current) setError(`${err.kind}: ${err.message}`);
    } finally {
      checking.current = false;
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
        readOnly={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (checking.current) leftDuringCheck.current = true;
          // The document has no focus when the whole window lost it.
          else if (document.hasFocus()) close("blur");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close("done");
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
