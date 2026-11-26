// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { pdfAnnotations, toWireError, type WireError } from "../ipc";
import { errorText } from "../ops/error-text";
import {
  addMarkupNote,
  addNote,
  deletePicked,
  recolourPicked,
  setNoteText,
} from "./annotation-actions";
import { AnnotationMenu } from "./AnnotationMenu";
import {
  DEFAULT_INK_WIDTH,
  annotationAt,
  fractionAt,
  inkOp,
  isMarkup,
  kindLabel,
  pickable,
  sameId,
  takesNote,
} from "./annotations";
import { InkTool } from "./InkTool";
import { NoteEditor } from "./NoteEditor";
import { whenPainted } from "./page-paint";
import { percent } from "./percent";
import { TextEditTool } from "./TextEditTool";
import { colourFor, usePdfTool } from "./pdf-tool";
import type { PageSize } from "./page-geometry";
import type { PdfDoc } from "./usePdfDoc";

const box = (r: readonly [number, number, number, number]) => ({
  left: percent(r[0]),
  top: percent(r[1]),
  width: percent(r[2] - r[0]),
  height: percent(r[3] - r[1]),
});

// The annotations of one page over its picture and its text. The engine draws them into the
// page's pixels; this layer is what is on top of those pixels: the boxes a key can reach, the
// outline and the menu of the one picked, the surface a line is drawn on (Ink), the surface a
// note is put on (Note), and the box a note's text is written in. A press is picked up in the
// text layer (a click on an annotation picks it, a drag still selects the text under it); this
// layer only has pointer events while a tool is in hand.
export function AnnotationLayer(props: {
  tabId: string;
  doc: PdfDoc;
  /** Counted from 0. */
  page: number;
  size: PageSize;
  /** The page's width on screen, in CSS pixels. */
  cssWidth: number;
  /** Near enough to the view to be read. */
  visible: boolean;
  /** The page's sizes are those of its last edit (see PageCanvas). */
  current: boolean;
}) {
  const { tabId, doc, page, size, cssWidth, visible, current } = props;
  const handle = doc.handle;
  const pageRevision = doc.pageRevisions[page] ?? 0;
  const tool = usePdfTool((s) => s.byTab[tabId]?.tool ?? "select");
  const picked = usePdfTool((s) => s.byTab[tabId]?.picked ?? null);
  const draft = usePdfTool((s) => s.byTab[tabId]?.draft ?? null);
  const inkWidth = usePdfTool((s) => s.byTab[tabId]?.inkWidth ?? DEFAULT_INK_WIDTH);
  const list = usePdfTool((s) => s.listed[tabId]?.[page]);
  const setListed = usePdfTool((s) => s.setListed);
  const dropListed = usePdfTool((s) => s.dropListed);
  const pick = usePdfTool((s) => s.pick);
  const setDraft = usePdfTool((s) => s.draft);
  const [failure, setFailure] = useState<WireError | null>(null);
  const noteSurface = useRef<HTMLDivElement>(null);

  const reading = visible && current && handle !== undefined;
  useEffect(() => {
    setFailure(null);
    if (!reading || handle === undefined) {
      dropListed(tabId, page);
      return;
    }
    let live = true;
    pdfAnnotations(handle, page).then(
      (read) => {
        if (live) setListed(tabId, page, read);
      },
      (e: unknown) => {
        if (live) setFailure(toWireError(e));
      }
    );
    return () => {
      live = false;
    };
    // The annotations are read again when an edit changes the page.
  }, [reading, handle, page, pageRevision, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => dropListed(tabId, page), [tabId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedHere = picked?.page === page ? picked : null;
  const mine = pickedHere
    ? list?.find((a) => a.id !== null && sameId(a.id, pickedHere.id))
    : undefined;

  // An annotation that is no longer on the page (deleted, or its addition undone) is not picked.
  useEffect(() => {
    if (pickedHere && list && !mine) pick(tabId, null);
  }, [pickedHere, list, mine, tabId, pick]);

  // Escape puts down the picked annotation. It never changes the tool: what a tool has in
  // progress (a line, a drag, a box) is ended by the tool, and the tool stays in hand.
  const holding = pickedHere !== null;
  useEffect(() => {
    if (!holding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (usePdfTool.getState().byTab[tabId]?.picked) pick(tabId, null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [holding, tabId, pick]);

  const canEdit = doc.canEdit;
  const pxPerPt = size.widthPt > 0 ? cssWidth / size.widthPt : 1;

  const putNote = (e: React.PointerEvent) => {
    if (e.button !== 0 || usePdfTool.getState().byTab[tabId]?.draft) return;
    const r = noteSurface.current?.getBoundingClientRect();
    const at = r ? fractionAt(e.clientX, e.clientY, r) : null;
    if (!at) return;
    // A press on a note, or on marked text, opens the note that is there instead of putting
    // another on top of it.
    const there = annotationAt(list ?? [], at[0], at[1]);
    if (there && takesNote(there)) {
      setDraft(tabId, { kind: "edit", page, id: there.id });
      return;
    }
    setDraft(tabId, { kind: "new", page, at });
  };

  const editing = draft?.page === page ? draft : null;
  const editedNote =
    editing?.kind === "edit"
      ? list?.find((a) => a.id !== null && sameId(a.id, editing.id))
      : undefined;

  return (
    <div className="kern-pdf-annotations" data-testid={`pdf-annotations-${page}`}>
      {tool === "select" &&
        list &&
        pickable(list).map((a, i) => (
          <button
            key={`${a.id.object}-${a.id.generation}-${i}`}
            type="button"
            className="kern-pdf-annotation"
            style={box(a.rect)}
            aria-label={`${kindLabel(a)} on page ${page + 1}`}
            aria-pressed={pickedHere ? sameId(pickedHere.id, a.id) : false}
            data-testid="pdf-annotation"
            // A press of the pointer is the text layer's; the key is the button's.
            onClick={(e) => {
              if (e.detail === 0) pick(tabId, { page, id: a.id });
            }}
          />
        ))}
      {mine && tool === "select" && (
        <>
          <span
            className="kern-pdf-annotation-picked"
            style={box(mine.rect)}
            data-testid="pdf-annotation-picked"
          />
          {!editing && (
            <AnnotationMenu
              annotation={mine}
              canEdit={canEdit}
              onColour={(colour) => void recolourPicked(tabId, doc, colour)}
              onEditText={() => mine.id && setDraft(tabId, { kind: "edit", page, id: mine.id })}
              onDelete={() => void deletePicked(tabId, doc)}
            />
          )}
        </>
      )}
      {tool === "ink" && canEdit && (
        <InkTool
          colour={colourFor(tabId, "ink")}
          widthPt={inkWidth}
          pxPerPt={pxPerPt}
          onGroup={async (strokes, colour, widthPt) => {
            const op = inkOp(page, strokes, colour, widthPt);
            if (!op) return;
            const outcome = await doc.applyChecked(op);
            // The lines stay on show until the page is drawn with them in it: the engine answers
            // before the picture is made, and without this they vanish and come back.
            if (outcome.status === "applied" && handle !== undefined) {
              await whenPainted(handle, page, outcome.revision);
            }
          }}
        />
      )}
      {tool === "note" && canEdit && (
        <div
          ref={noteSurface}
          className="kern-pdf-note-surface"
          data-testid="pdf-note-surface"
          onPointerDown={putNote}
        />
      )}
      {tool === "editText" && canEdit && reading && (
        <TextEditTool doc={doc} page={page} size={size} cssWidth={cssWidth} />
      )}
      {editing?.kind === "new" && (
        <NoteEditor
          at={{ left: editing.at[0], top: editing.at[1] }}
          initial=""
          commitLabel="Add note"
          onCancel={() => setDraft(tabId, null)}
          onCommit={(text) => {
            setDraft(tabId, null);
            void addNote(tabId, doc, page, editing.at, text);
          }}
        />
      )}
      {editing?.kind === "markup" && (
        <NoteEditor
          at={{ left: editing.at[0], top: editing.at[1] }}
          initial=""
          commitLabel="Add note"
          onCancel={() => setDraft(tabId, null)}
          onCommit={(text) => {
            setDraft(tabId, null);
            void addMarkupNote(tabId, doc, page, editing.rects, text);
          }}
        />
      )}
      {editing?.kind === "edit" && editedNote && (
        <NoteEditor
          at={{ left: editedNote.rect[0], top: editedNote.rect[1] }}
          initial={editedNote.contents ?? ""}
          // Marked text can have its note taken away by saving nothing; a note keeps some text.
          allowEmpty={isMarkup(editedNote)}
          commitLabel="Save"
          onCancel={() => setDraft(tabId, null)}
          onCommit={(text) => {
            setDraft(tabId, null);
            void setNoteText(doc, page, editing.id, text);
          }}
        />
      )}
      {failure && (
        <p className="kern-pdf-text-error" role="alert">
          The annotations of page {page + 1} could not be read: {errorText(failure)}
        </p>
      )}
    </div>
  );
}
