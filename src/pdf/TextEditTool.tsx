// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { pdfText, toWireError, type WireError } from "../ipc";
import type { PdfTextBlock } from "../ipc/pdf";
import { errorText } from "../ops/error-text";
import { fractionAt } from "./annotations";
import { BlockRefused } from "./BlockRefused";
import { blockText, submitBlockEdit, type BlockTarget } from "./block-edit";
import { boxChange, type Sides } from "./box-sides";
import { BoxSides } from "./BoxSides";
import {
  DEFAULT_NEW_SIZE_PT,
  MIN_WIDTH_PT,
  NEW_SIZE_RANGE_PT,
  SNAP_PX,
  nearestLineRect,
  placeNewText,
  snapRight,
  submitNewText,
  type NewTextPlace,
} from "./new-text";
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
/** How far, in CSS pixels, the pointer moves on empty space before the press is a drag that sets a width. */
const DRAG_PX = 4;

interface Chosen {
  target: BlockTarget;
  block: PdfTextBlock;
}

// The Edit text tool over one page: each block of the page's text is a button, a block that can be
// edited opens a box with its text where it stands and a block that cannot says why. A click on the
// page where there is no text opens an empty box there for new text, running to the right edge of
// the page's text; a drag sets how wide it runs, and its end takes a width of the page's text when
// it comes near one. Both sides of a box are handles that can be dragged (or moved with the arrow
// keys): the left side moves its left edge and the right side its right edge. Enter keeps the text
// (one change), Shift+Enter starts a line, Escape lets the box go. A press outside an open box
// keeps what was typed, as Enter does, and does nothing else: it opens no other box. A change the
// engine refuses keeps the box and says why in it. The box asks nothing else of the page: it grows
// downward and nothing moves. Escape also ends a drag that sets a width and puts the refusal away.
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
  const [adding, setAdding] = useState<NewTextPlace | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  // What the open box does to keep its text; the press that leaves the box calls it.
  const commitRef = useRef<(() => void) | null>(null);
  const openRef = useRef(false);
  // The press that left a box is not also a press that begins something: the box can close before
  // the page sees the rest of that press.
  const leaving = useRef(false);

  // The text is read again when an edit changes the page; what was chosen belonged to the page as
  // it was.
  useEffect(() => {
    setRefused(null);
    setEditing(null);
    setAdding(null);
    setDrag(null);
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
  const open = editing !== null || adding !== null;
  openRef.current = open;

  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      if (!openRef.current) {
        leaving.current = false;
        return;
      }
      const inside =
        e.target instanceof Element && e.target.closest(".kern-pdf-block-box, [role='dialog']");
      if (inside) return;
      leaving.current = true;
      commitRef.current?.();
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, []);

  // Escape ends a drag that is setting a width and puts the refusal away; a box has its own.
  useEffect(() => {
    if (!drag && !refused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setDrag(null);
      setRefused(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag, refused]);

  const pointAt = (e: React.PointerEvent): [number, number] | null => {
    const r = surface.current?.getBoundingClientRect();
    return r ? fractionAt(e.clientX, e.clientY, r) : null;
  };
  const press = (e: React.PointerEvent) => {
    if (e.button !== 0 || open || leaving.current || !text) return;
    const at = pointAt(e);
    if (!at) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setRefused(null);
    setDrag({ down: at, up: at, client: [e.clientX, e.clientY], dragged: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const at = pointAt(e);
    if (!at) return;
    const moved = Math.hypot(e.clientX - drag.client[0], e.clientY - drag.client[1]) > DRAG_PX;
    setDrag({ ...drag, up: at, dragged: drag.dragged || moved });
  };
  const release = (e: React.PointerEvent) => {
    if (!drag) return;
    const up = pointAt(e) ?? drag.up;
    setDrag(null);
    const place = placeNewText({
      text,
      page,
      down: drag.down,
      up,
      dragged: drag.dragged,
      widthPt: size.widthPt,
      cssWidth,
    });
    if (place) setAdding(place);
  };
  const dragged = drag?.dragged ? dragBox(drag, text, page, size, cssWidth) : null;
  const label = (block: PdfTextBlock): string => {
    const first = text?.lines.find((l) => l.block === block.id)?.text.trim() ?? "";
    const excerpt = Array.from(first).slice(0, LABEL_CHARACTERS).join("");
    const what = block.editable ? "Edit text" : "Text that cannot be edited";
    return excerpt ? `${what}: ${excerpt}` : what;
  };

  return (
    <div className="kern-pdf-blocks" data-testid={`pdf-blocks-${page}`}>
      {text && (
        <div
          ref={surface}
          className="kern-pdf-new-text-surface"
          data-testid={`pdf-new-text-surface-${page}`}
          aria-hidden
          onPointerDown={press}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={() => setDrag(null)}
        />
      )}
      {dragged && (
        <span
          className="kern-pdf-new-text-drag"
          data-testid="pdf-new-text-drag"
          style={{
            left: percent(dragged.at[0]),
            top: percent(dragged.at[1]),
            width: percent(dragged.width),
          }}
        />
      )}
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
          disabled={open}
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
          widthPt={size.widthPt}
          commitRef={commitRef}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && text && (
        <NewTextBox
          doc={doc}
          place={adding}
          text={text}
          cssHeight={cssHeight}
          pxPerPt={size.widthPt > 0 ? cssWidth / size.widthPt : 1}
          widthPt={size.widthPt}
          cssWidth={cssWidth}
          commitRef={commitRef}
          onClose={() => setAdding(null)}
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

interface Drag {
  /** Page fractions. */
  down: [number, number];
  up: [number, number];
  /** Where the press was made on screen, to tell a click from a drag. */
  client: [number, number];
  dragged: boolean;
}

/** The line a drag draws while it sets a width: the box that a release there would open. */
function dragBox(
  drag: Drag,
  text: PageText | null,
  page: number,
  size: PageSize,
  cssWidth: number
): NewTextPlace | null {
  return placeNewText({
    text,
    page,
    down: drag.down,
    up: drag.up,
    dragged: true,
    widthPt: size.widthPt,
    cssWidth,
  });
}

// The box new text is typed in. It stands where the text will: its top left corner and its width
// are those the engine is given, and its letters are drawn at the size of the nearest text, which
// is the text the engine follows. A page with no text to follow asks for a size, and the box shows
// a field for it, with what was typed kept.
function NewTextBox(props: {
  doc: PdfDoc;
  place: NewTextPlace;
  text: PageText;
  cssHeight: number;
  /** CSS pixels to a point of the page. */
  pxPerPt: number;
  /** The page's width in points and on screen, for the least width and the snap of a side. */
  widthPt: number;
  cssWidth: number;
  commitRef: React.MutableRefObject<(() => void) | null>;
  onClose(): void;
}) {
  const { doc, place, text, cssHeight, pxPerPt, widthPt, cssWidth, commitRef, onClose } = props;
  const [sides, setSides] = useState<Sides>({
    left: place.at[0],
    right: place.at[0] + place.width,
  });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<string | null>(null);
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
    // A box with nothing in it puts nothing on the page.
    if (value.trim() === "") {
      onClose();
      return;
    }
    let points: number | undefined;
    if (size !== null) {
      points = Number(size);
      if (
        size.trim() === "" ||
        !Number.isFinite(points) ||
        points < NEW_SIZE_RANGE_PT.min ||
        points > NEW_SIZE_RANGE_PT.max
      ) {
        setError(
          `The size is a number of points from ${NEW_SIZE_RANGE_PT.min} to ${NEW_SIZE_RANGE_PT.max}.`
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    const placed: NewTextPlace = {
      ...place,
      at: [sides.left, place.at[1]],
      width: sides.right - sides.left,
    };
    const result = await submitNewText(doc, placed, value, points);
    if (!mounted.current) return;
    setBusy(false);
    if (result.status === "done") onClose();
    else if (result.status === "needs-size") {
      setSize(String(DEFAULT_NEW_SIZE_PT));
      setError(
        "This page has no text for the new text to take its font, size and colour from. Choose a size and press Enter."
      );
    } else if (result.status === "failed") setError(result.message);
  };

  commitRef.current = () => void keep();
  useEffect(() => () => void (commitRef.current = null), [commitRef]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      void keep();
    }
  };

  // The letters of the box: at the size chosen, at the page's scale, or else at the size of the
  // nearest text's lines.
  const points = size === null ? NaN : Number(size);
  const like = nearestLineRect(text, place.at);
  const fontSize =
    Number.isFinite(points) && points > 0
      ? points * pxPerPt
      : like
        ? (like[3] - like[1]) * cssHeight * FONT_FRACTION
        : undefined;
  const lineHeight =
    fontSize === undefined ? undefined : `${(fontSize / FONT_FRACTION) * SINGLE_LINE_LEADING}px`;

  return (
    <div
      className="kern-pdf-block-box kern-pdf-new-text-box"
      style={{
        left: percent(sides.left),
        top: percent(place.at[1]),
        width: percent(sides.right - sides.left),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <BoxSides
        sides={sides}
        min={widthPt > 0 ? MIN_WIDTH_PT / widthPt : 0}
        snapRight={(right, left) => snapRight(text, left, right, SNAP_PX / cssWidth)}
        disabled={busy}
        onChange={setSides}
      />
      <textarea
        ref={field}
        className="kern-pdf-block-input"
        aria-label="New text"
        rows={Math.max(1, value.split("\n").length)}
        value={value}
        disabled={busy}
        style={{ fontSize, lineHeight }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
      />
      {size !== null && (
        <label className="kern-pdf-new-text-size">
          Size in points
          <input
            type="number"
            min={NEW_SIZE_RANGE_PT.min}
            max={NEW_SIZE_RANGE_PT.max}
            step="any"
            value={size}
            disabled={busy}
            onChange={(e) => setSize(e.target.value)}
            onKeyDown={onKey}
          />
        </label>
      )}
      {error && (
        <p className="kern-pdf-block-error" role="alert">
          {error}
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
  /** The page's width in points, for the least width of the box. */
  widthPt: number;
  commitRef: React.MutableRefObject<(() => void) | null>;
  onClose(): void;
}) {
  const { doc, chosen, text, cssHeight, widthPt, commitRef, onClose } = props;
  const { target, block } = chosen;
  const was: Sides = { left: block.rect[0], right: block.rect[2] };
  const [sides, setSides] = useState<Sides>(was);
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
    // Text that is as it was, in the box it was in, is no change.
    const box = boxChange(was, sides);
    if (value === target.original && box.left === undefined && box.width === undefined) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitBlockEdit(
      doc,
      target,
      value,
      () =>
        // A fresh read: the kept one is the very text that was refused as stale.
        pdfText(doc.handle as number, target.page).then(pageText),
      box
    );
    if (!mounted.current) return;
    setBusy(false);
    if (result.status === "done") onClose();
    else if (result.status === "failed") setError(result.message);
  };

  commitRef.current = () => void keep();
  useEffect(() => () => void (commitRef.current = null), [commitRef]);

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
        left: percent(sides.left),
        top: percent(block.rect[1]),
        width: percent(sides.right - sides.left),
      }}
      // A press in the box is the box's.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <BoxSides
        sides={sides}
        min={widthPt > 0 ? MIN_WIDTH_PT / widthPt : 0}
        disabled={busy}
        onChange={setSides}
      />
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
