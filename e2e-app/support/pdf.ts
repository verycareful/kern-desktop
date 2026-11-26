// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// PDFs for the specs to open: one page with a correct cross-reference table, so each opens as a
// document that can be edited and saved.

/** The bytes of a one-page PDF with no text. */
export function onePagePdf(): Buffer {
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>",
  ]);
}

/** The text on the page of `textPagePdf`. */
export const PAGE_TEXT = "Hello Kern";

/** The bytes of a one-page PDF with one line of text, `PAGE_TEXT`, in a standard font. */
export function textPagePdf(): Buffer {
  const content = `BT /F1 24 Tf 20 150 Td (${PAGE_TEXT}) Tj ET`;
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

/** The address the link of `linkPagePdf` carries. */
export const LINK_ADDRESS = "https://example.org/kern";

/**
 * The bytes of a one-page PDF with the text `PAGE_TEXT` and a link box over it that leads to
 * `LINK_ADDRESS`.
 */
export function linkPagePdf(): Buffer {
  const content = `BT /F1 24 Tf 20 150 Td (${PAGE_TEXT}) Tj ET`;
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Annot /Subtype /Link /Rect [10 140 190 180] /Border [0 0 0] /A << /S /URI /URI (${LINK_ADDRESS}) >> >>`,
  ]);
}

function pdfOf(objects: string[]): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, n) => {
    offsets.push(out.length);
    out += `${n + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
