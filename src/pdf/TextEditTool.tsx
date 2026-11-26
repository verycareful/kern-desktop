// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { pdfText, toWireError, type WireError } from "../ipc";
import type { PdfTextBlock } from "../ipc/pdf";
import { errorText } from "../ops/error-text";
import { BlockRefused } from "./BlockRefused";
import { blockText, submitBlockEdit, type BlockTarget } from "./block-edit";
import { loadPageText } from "./page-text";
import { percent } from "./percent";
import type { PageSize } from "./page-geometry";
import { pageText, type PageText } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

/** How much of a line's height the letters of the box take. */
const FONT_FRACTION = 0.85;
/** The space between lines, as a multiple of a line's height, when the block has only one line. */
const SINGLE_LINE_LEADING = 1.2;
/** The most of a block's text a button names. */
const LABEL_CHARACTERS = 40;

interface Chosen {
  target: BlockTarget;
  block: PdfTextBlock;
}

// The Edit text tool over one page: each block of the page's text is a button, a block that can be
// edited opens a box with its text where it stands and a block that cannot says why. Enter keeps
// the text (one change), Shift+Enter starts a line, Escape lets the box go. A change the engine
// refuses keeps the box and says why in it. The box asks nothing else of the page: it grows
// downward and nothing moves. While a box is open the other blocks wait, so text that was typed is
// never dropped by a click elsewhere.
export function TextEditTool(props: {
  doc: PdfDoc;
  /** Counted from 0. */
  page: number;
  size: PageSize;
  /** The page's width on screen, in CSS pixels. */
  cssWidth: number;
}) {
  const { doc, page, size, cssWidth } = props;
  const handle = doc.handle;
  const pageRevision = doc.pageRevisions[page] ?? 0;
  const [text, setText] = useState<PageText | null>(null);
  const [failure, setFailure] = useState<WireError | null>(null);
  const [refused, setRefused] = useState<PdfTextBlock | null>(null);
  const [editing, setEditing] = useState<Chosen | null>(null);

  // The text is read again when an edit changes the page; what was chosen belonged to the page as
  // it was.
  useEffect(() => {
    setRefused(null);
    setEditing(null);
    setFailure(null);
    if (handle === undefined) return;
    let live = true;
    loadPageText(doc, page).then(
      (read) => {
        if (live) setText(read);
      },
      (e: unknown) => {
        if (live) setFailure(toWireError(e));
      }
    );
    return () => {
      live = false;
    };
  }, [handle, page, pageRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (block: PdfTextBlock) => {
    if (!text) return;
    if (!block.editable) {
      setRefused(block);
      return;
    }
    setRefused(null);
    setEditing({
      block,
      target: {
        page,
        block: block.id,
        revision: text.revision,
        original: blockText(text, block.id),
        rect: block.rect,
      },
    });
  };

  const cssHeight = size.widthPt > 0 ? (cssWidth * size.heightPt) / size.widthPt : cssWidth;
  const label = (block: PdfTextBlock): string => {
    const first = text?.lines.find((l) => l.block === block.id)?.text.trim() ?? "";
    const excerpt = Array.from(first).slice(0, LABEL_CHARACTERS).join("");
    const what = block.editable ? "Edit text" : "Text that cannot be edited";
    return excerpt ? `${what}: ${excerpt}` : what;
  };

  return (
    <div className="kern-pdf-blocks" data-testid={`pdf-blocks-${page}`}>
      {text?.blocks.map((block) => (
        <button
          key={block.id}
          type="button"
          className={`kern-pdf-block${block.editable ? "" : " kern-pdf-block-refused-mark"}`}
          style={{
            left: percent(block.rect[0]),
            top: percent(block.rect[1]),
            width: percent(block.rect[2] - block.rect[0]),
            height: percent(block.rect[3] - block.rect[1]),
          }}
          aria-label={label(block)}
          disabled={editing !== null}
          hidden={editing?.block.id === block.id}
          onClick={() => choose(block)}
        />
      ))}
      {refused && (
        <BlockRefused
          rect={refused.rect}
          reason={refused.reason}
          onClose={() => setRefused(null)}
        />
      )}
      {editing && text && (
        <BlockBox
          doc={doc}
          chosen={editing}
          text={text}
          cssHeight={cssHeight}
          onClose={() => setEditing(null)}
        />
      )}
      {failure && (
        <p className="kern-pdf-text-error" role="alert">
          The text of page {page + 1} could not be read: {errorText(failure)}
        </p>
      )}
    </div>
  );
}

function BlockBox(props: {
  doc: PdfDoc;
  chosen: Chosen;
  text: PageText;
  cssHeight: number;
  onClose(): void;
}) {
  const { doc, chosen, text, cssHeight, onClose } = props;
  const { target, block } = chosen;
  const [value, setValue] = useState(target.original);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    field.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const keep = async () => {
    if (busy) return;
    // Text that is as it was is no change.
    if (value === target.original) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitBlockEdit(doc, target, value, () =>
      // A fresh read: the kept one is the very text that was refused as stale.
      pdfText(doc.handle as number, target.page).then(pageText)
    );
    if (!mounted.current) return;
    setBusy(false);
    if (result.status === "done") onClose();
    else if (result.status === "failed") setError(result.message);
  };

  const lines = text.lines.filter((l) => l.block === block.id);
  const first = lines[0];
  const lineHeight = first
    ? lines[1]
      ? (lines[1].rect[1] - first.rect[1]) * cssHeight
      : (first.rect[3] - first.rect[1]) * cssHeight * SINGLE_LINE_LEADING
    : undefined;
  const fontSize = first ? (first.rect[3] - first.rect[1]) * cssHeight * FONT_FRACTION : undefined;

  return (
    <div
      className="kern-pdf-block-box"
      style={{
        left: percent(block.rect[0]),
        top: percent(block.rect[1]),
        width: percent(block.rect[2] - block.rect[0]),
      }}
      // A press in the box is the box's.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={field}
        className="kern-pdf-block-input"
        aria-label="Text of the block"
        rows={Math.max(1, value.split("\n").length)}
        value={value}
        disabled={busy}
        style={{
          minHeight: percent(block.rect[3] - block.rect[1]),
          fontSize,
          lineHeight: lineHeight === undefined ? undefined : `${lineHeight}px`,
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            void keep();
          }
        }}
      />
      {error && (
        <p className="kern-pdf-block-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
