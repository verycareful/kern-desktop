// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Location, WirePath } from "../ipc";
import { ReadOnlyBanner } from "../editor/ReadOnlyBanner";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { PasswordPrompt } from "./PasswordPrompt";
import { PanelDock } from "./PanelDock";
import { usePdfDocController } from "./pdf-doc-controller";
import { usePdfDoc } from "./usePdfDoc";
import "./pdf.css";

/** How a document that has settled tells the window that holds it: open and registered, or why not. */
export type Settled = { ok: true } | { ok: false; reason: string };

// A PDF as a document tab shows it. It takes the props of the text editor so one `DocView`
// can stand for either.
export function PdfViewer(props: {
  tabId: string;
  path: WirePath;
  active: boolean;
  /** Where the document is open; a tab of `tabId` when not given. */
  location?: Location;
  /** Registered as open here before the viewer mounted. */
  registered?: boolean;
  /** Called once: with ok when the document is open and registered, else with why it is not. */
  onSettled?: (result: Settled) => void;
}) {
  const { tabId, path, active } = props;
  const settled = useRef(false);
  const onSettled = useRef(props.onSettled);
  useLayoutEffect(() => {
    onSettled.current = props.onSettled;
  });
  const settle = (result: Settled) => {
    if (settled.current) return;
    settled.current = true;
    onSettled.current?.(result);
  };
  const doc = usePdfDoc(tabId, path, {
    location: props.location,
    registered: props.registered,
    onRegistered: (ok) =>
      settle(
        ok
          ? { ok: true }
          : { ok: false, reason: "the document could not be registered as open in this window" }
      ),
  });
  usePdfDocController(tabId, doc);
  useEffect(() => {
    if (doc.phase === "failed") {
      settle({
        ok: false,
        reason: `${baseName(path)} could not be opened${doc.error ? `: ${errorText(doc.error)}` : ""}`,
      });
    }
    // `settle` only reads refs.
  }, [doc.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = baseName(path);
  let body;
  if (doc.phase === "opening") {
    body = (
      <div className="kern-doc-note" role="status" data-testid="pdf-opening">
        <p>Opening {name}…</p>
      </div>
    );
  } else if (doc.phase === "needs-password") {
    body = (
      <div className="kern-doc-note" role="status" data-testid="pdf-needs-password">
        <p>{name} is password protected.</p>
      </div>
    );
  } else if (doc.phase === "failed") {
    body = (
      <div className="kern-doc-note" role="alert" data-testid="pdf-failed">
        <p>{name} could not be opened.</p>
        {doc.error && <p>{errorText(doc.error)}</p>}
      </div>
    );
  } else if (doc.pages === 0) {
    body = (
      <div className="kern-doc-note" role="status" data-testid="pdf-empty">
        <p>{name} has no pages.</p>
      </div>
    );
  } else {
    body = <PanelDock tabId={tabId} doc={doc} active={active} />;
  }

  return (
    <section
      className="kern-doc-editor kern-pdf-viewer"
      hidden={!active}
      aria-label={`PDF viewer for ${name}`}
      data-testid="pdf-viewer"
      data-tab-id={tabId}
    >
      {doc.phase === "ready" && doc.readOnly && <ReadOnlyBanner readOnly={doc.readOnly} />}
      {body}
      {active && doc.phase === "needs-password" && (
        <PasswordPrompt
          path={path}
          wrong={doc.error !== undefined}
          onSubmit={(password) => void doc.open(password)}
          onCancel={doc.cancelPassword}
        />
      )}
    </section>
  );
}
