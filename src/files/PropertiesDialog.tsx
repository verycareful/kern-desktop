// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import {
  appDefault,
  displayPath,
  entryOf,
  parent,
  pathKey,
  properties,
  toWireError,
  type WireAppDefault,
  type WireEntry,
  type WireError,
  type WirePath,
  type WireProperties,
} from "../ipc";
import { Modal } from "../ops/Modal";
import { errorText } from "../ops/error-text";
import { baseName, plural } from "../ops/labels";
import { runOp, type RunningOp } from "../ops/run-op";
import { isFolder } from "./file-type";
import { formatSize } from "./format";
import { modeOctal, modeText } from "./permissions";

// Properties (design 5.1): for one item its type, place, size,
// modification time, permissions as letters and octal, MIME type and, for a
// file, the application that opens it; for several, how many and their size
// together. Sizes come from the properties operation, which walks folders in
// the background and reports what it could not read; closing the dialog
// cancels it. Every part that cannot be found out says so in its place.

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" });

type Load<T> =
  { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: WireError };

interface Measure {
  /** Entries counted so far, while it runs. */
  counted: number;
  result: WireProperties | null;
  error: WireError | null;
}

function kindText(e: WireEntry): string {
  switch (e.kind) {
    case "dir":
      return "Folder";
    case "symlink":
      return e.target_is_dir ? "Link to a folder" : "Link";
    case "file":
      return "File";
    default:
      return "Special file";
  }
}

/** Runs the properties operation on `paths`; cancelled when the dialog closes. */
function useMeasure(paths: readonly WirePath[]): Measure {
  const [m, setM] = useState<Measure>({ counted: 0, result: null, error: null });
  const key = paths.map(pathKey).join("\n");
  useEffect(() => {
    let live = true;
    let ended = false;
    setM({ counted: 0, result: null, error: null });
    const op: RunningOp = runOp(
      () => properties([...paths]),
      (p) => live && setM((s) => ({ ...s, counted: p.done }))
    );
    op.done.then(
      (d) => {
        ended = true;
        if (!live) return;
        if (d.error) setM((s) => ({ ...s, error: d.error }));
        else if (d.properties) setM((s) => ({ ...s, result: d.properties }));
        else
          setM((s) => ({
            ...s,
            error: {
              kind: "Ipc",
              message: "the operation ended without a size",
              path: null,
              details: null,
            },
          }));
      },
      (e: unknown) => {
        ended = true;
        if (live) setM((s) => ({ ...s, error: toWireError(e) }));
      }
    );
    return () => {
      live = false;
      // Nothing is waiting for the answer any more; the walk is stopped. A cancel that fails
      // only leaves a walk running to its end, which changes nothing on disk.
      if (!ended) op.cancel().catch(() => undefined);
    };
    // `key` stands for `paths`, which a caller may build anew on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}

function useLoad<T>(load: (() => Promise<T>) | null, key: string): Load<T> {
  const [l, setL] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setL({ state: "loading" });
    load().then(
      (value) => live && setL({ state: "ready", value }),
      (e: unknown) => live && setL({ state: "failed", error: toWireError(e) })
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return l;
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </>
  );
}

/**
 * `contents`: for one folder, what it holds (the walk counts the folder itself, so it is taken
 * off); for several items, everything counted, the items themselves included; for one file or
 * link, nothing.
 */
function SizeRow(props: { m: Measure; contents: "folder" | "items" | null; note?: string }) {
  const { m } = props;
  if (m.error) {
    return (
      <Row label="Size">
        <span role="alert">could not be found out: {errorText(m.error)}</span>
      </Row>
    );
  }
  if (!m.result) {
    return (
      <Row label="Size">
        <span role="status">Counting… {plural(m.counted, "item", "items")}</span>
      </Row>
    );
  }
  const r = m.result;
  const atLeast = r.unreadable.length > 0 || r.cancelled ? "at least " : "";
  return (
    <>
      <Row label="Size">
        {atLeast}
        {formatSize(r.bytes)} ({r.bytes.toLocaleString("en-US")} bytes){props.note}
      </Row>
      {props.contents === "folder" && (
        <Row label="Contains">
          {plural(r.files, "file", "files")}, {plural(Math.max(r.dirs - 1, 0), "folder", "folders")}
        </Row>
      )}
      {props.contents === "items" && (
        <Row label="In all">
          {plural(r.files, "file", "files")}, {plural(r.dirs, "folder", "folders")}, counting the
          selected items themselves
        </Row>
      )}
      {r.unreadable.length > 0 && (
        <Row label="Not read">
          <details>
            <summary>{plural(r.unreadable.length, "item", "items")} could not be read</summary>
            <ul>
              {r.unreadable.map((p) => (
                <li key={pathKey(p)}>{displayPath(p)}</li>
              ))}
            </ul>
          </details>
        </Row>
      )}
    </>
  );
}

function OpensWith(props: { load: Load<WireAppDefault> }) {
  const { load } = props;
  if (load.state === "loading") return <Row label="Opens with">…</Row>;
  if (load.state === "failed") {
    return (
      <Row label="Opens with">
        <span role="alert">could not be found out: {errorText(load.error)}</span>
      </Row>
    );
  }
  const { app, problems } = load.value;
  return (
    <Row label="Opens with">
      {app ? app.name : "No default application"}
      {problems.length > 0 && (
        <details>
          <summary>
            {plural(problems.length, "application entry", "application entries")} could not be read
          </summary>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{errorText(p)}</li>
            ))}
          </ul>
        </details>
      )}
    </Row>
  );
}

function One(props: { path: WirePath }) {
  const key = pathKey(props.path);
  const entry = useLoad(() => entryOf(props.path), key);
  const m = useMeasure([props.path]);
  const isFile = entry.state === "ready" && !isFolder(entry.value);
  const app = useLoad(isFile ? () => appDefault(props.path) : null, `${key}:${isFile}`);
  const where = parent(props.path);
  if (entry.state === "loading") return <p role="status">Reading…</p>;
  if (entry.state === "failed") {
    return (
      <p role="alert" className="kern-modal-error">
        {baseName(props.path)} could not be read: {errorText(entry.error)}
      </p>
    );
  }
  const e = entry.value;
  return (
    <dl className="kern-properties">
      <Row label="Name">{e.name}</Row>
      <Row label="Type">
        {kindText(e)} ({e.mime})
      </Row>
      {where && <Row label="Location">{displayPath(where)}</Row>}
      {/* The walk does not follow a link: its size is the link's own, and it holds nothing. */}
      <SizeRow
        m={m}
        contents={e.kind === "dir" ? "folder" : null}
        note={e.kind === "symlink" ? ", the link itself, not what it points to" : undefined}
      />
      <Row label="Modified">
        {e.modified_ms === null ? "not known" : WHEN.format(new Date(e.modified_ms))}
      </Row>
      <Row label="Permissions">
        {e.kind === "symlink"
          ? "none of its own: a link is used with the permissions of what it points to"
          : `${modeText(e.mode)} (${modeOctal(e.mode)})`}
      </Row>
      {isFile && <OpensWith load={app} />}
    </dl>
  );
}

function Several(props: { paths: WirePath[] }) {
  const m = useMeasure(props.paths);
  const parents = new Set(
    props.paths.map((p) => {
      const up = parent(p);
      return up ? pathKey(up) : "";
    })
  );
  const where = parents.size === 1 ? parent(props.paths[0]!) : null;
  return (
    <dl className="kern-properties">
      <Row label="Items">{props.paths.length.toLocaleString("en-US")}</Row>
      {where && <Row label="Location">{displayPath(where)}</Row>}
      <SizeRow m={m} contents="items" />
    </dl>
  );
}

export function PropertiesDialog(props: { paths: WirePath[]; onClose(): void }) {
  const { paths, onClose } = props;
  const only = paths.length === 1 ? paths[0]! : null;
  const title = only
    ? `Properties of ${baseName(only)}`
    : `Properties of ${plural(paths.length, "item", "items")}`;
  return (
    <Modal role="dialog" label={title} onEscape={onClose} testId="properties-dialog">
      <h2 className="kern-modal-title">{title}</h2>
      {only ? <One path={only} /> : <Several paths={paths} />}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
