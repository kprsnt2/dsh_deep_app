import { jsPDF } from "jspdf";

/**
 * Render a Markdown answer to a clean, print-ready A4 PDF.
 *
 * This is deliberately not an HTML-to-canvas conversion: we lay out text
 * directly with jsPDF so the output is vector, selectable, small, and prints
 * sharply. The layout targets worksheets specifically - generous answer
 * space, ruled blanks, and page numbers.
 */

interface Line {
  text: string;
  size: number;
  style: "normal" | "bold" | "italic";
  gapBefore: number;
  /** Extra vertical space reserved after the line, for writing answers. */
  gapAfter: number;
  indent: number;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** jsPDF's built-in fonts are latin-1; swap characters it cannot encode. */
function sanitize(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25CF]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u2192/g, "->")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/[^\x00-\xFF]/g, "");
}

/** Strip Markdown syntax down to plain text for PDF layout. */
function stripInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
}

/**
 * Collapse long runs of underscores into a fixed-width fill-in blank.
 * Models emit anything from "____" to 40 underscores; normalising keeps
 * question lines short so they do not wrap or run off the page.
 */
function normalizeBlanks(s: string): string {
  return s.replace(/_{3,}/g, "__________");
}

/** Parse Markdown into a flat list of styled lines. */
function parse(md: string): Line[] {
  const lines: Line[] = [];
  const src = md.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  let codeBuf: string[] = [];
  /**
   * Once we pass an "Answer Key" heading, stop reserving writing space:
   * answers are for the teacher to read, not for the child to fill in.
   * Without this the key sprawls across extra pages.
   */
  let inAnswerKey = false;

  const push = (
    text: string,
    size: number,
    style: Line["style"],
    gapBefore = 0,
    gapAfter = 0,
    indent = 0,
  ) => {
    lines.push({ text, size, style, gapBefore, gapAfter, indent });
  };

  for (const raw of src) {
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        for (const c of codeBuf) push(c, 9.5, "normal", 0, 0, 4);
        push("", 6, "normal");
        inCode = false;
        codeBuf = [];
      } else {
        inCode = true;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    const line = raw.trimEnd();

    // Table rows: flatten to "a | b | c" - readable and honest.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => stripInline(c.trim()));
      push(cells.join("   |   "), 10, "normal", 0, 1, 2);
      continue;
    }

    if (line.trim() === "") {
      push("", 6, "normal");
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const headingText = stripInline(h[2]);
      if (/answer\s*key|answers|marking\s*scheme|solutions/i.test(headingText)) {
        inAnswerKey = true;
      }
      const size = lvl === 1 ? 19 : lvl === 2 ? 15 : 12.5;
      const gapBefore = lvl === 1 ? 2 : 8;
      push(headingText, size, "bold", gapBefore, lvl <= 2 ? 4 : 2);
      if (lvl === 1) push("", 2, "normal");
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      push("", 4, "normal");
      push("____________________________________________________", 10, "normal", 0, 6);
      continue;
    }

    // Fill-in-the-blank detection: reserve writing space after such lines.
    const blanks = (line.match(/_{2,}/g) ?? []).length;
    const isQuestion = /^\s*(\d+[.)]|[-*+])\s/.test(line);
    // A question with a trailing blank line needs room to write, but a plain
    // short question does not - otherwise the sheet sprawls over many pages.
    const hasOwnBlankLine = blanks > 0;
    const needsSpace = inAnswerKey
      ? 0
      : hasOwnBlankLine
        ? 10
        : isQuestion
          ? 7
          : 0;

    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) {
      push(`${ol[1]}. ${normalizeBlanks(stripInline(ol[2]))}`, 11, "normal", 2, needsSpace, 2);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      push(`- ${normalizeBlanks(stripInline(ul[1]))}`, 11, "normal", 1, needsSpace, 4);
      continue;
    }

    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      push(stripInline(bq[1]), 10, "italic", 1, 2, 6);
      continue;
    }

    push(normalizeBlanks(stripInline(line)), 11, "normal", 1, needsSpace, 0);
  }

  return lines;
}

export interface PdfOptions {
  title?: string;
  /** Show name/date/score header lines for worksheets. */
  worksheetHeader?: boolean;
}

/** Build the PDF and return it as a Blob. */
export function markdownToPdf(md: string, opts: PdfOptions = {}): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const lines = parse(md);

  let y = MARGIN;
  let page = 1;

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Page ${page}`, PAGE_W / 2, PAGE_H - 8, { align: "center" });
    doc.setTextColor(0);
  };

  // A title only goes in the running header when the body does NOT already
  // start with an H1, otherwise the same words print twice.
  const bodyStartsWithH1 = /^\s*#\s+/.test(md);
  if (opts.title && !bodyStartsWithH1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(90);
    doc.text(sanitize(opts.title), PAGE_W / 2, MARGIN - 8, { align: "center" });
    doc.setTextColor(0);
  } else if (opts.title) {
    // Keep a small running header so printed pages can be identified.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(sanitize(opts.title).slice(0, 90), PAGE_W / 2, MARGIN - 8, {
      align: "center",
    });
    doc.setTextColor(0);
  }

  for (const ln of lines) {
    y += ln.gapBefore;

    const isRule = ln.text.startsWith("_____");
    const text = isRule ? ln.text : sanitize(ln.text);

    if (ln.text !== "") {
      doc.setFont("helvetica", ln.style);
      doc.setFontSize(ln.size);

      const maxW = CONTENT_W - ln.indent;
      const wrapped: string[] = doc.splitTextToSize(text, maxW);
      const lineH = ln.size * 0.42;

      // Page break if this block will not fit.
      if (y + wrapped.length * lineH > PAGE_H - MARGIN - 6) {
        drawFooter();
        doc.addPage();
        page++;
        y = MARGIN;
      }

      doc.text(wrapped, MARGIN + ln.indent, y);
      y += wrapped.length * lineH;
    } else {
      y += ln.size * 0.35;
    }

    y += ln.gapAfter;
  }

  drawFooter();
  return doc.output("blob");
}

/** Trigger a download of the generated PDF. */
export function downloadPdf(md: string, filename: string, opts?: PdfOptions) {
  const blob = markdownToPdf(md, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Suggest a sensible filename from the chat title / content. */
export function suggestFilename(title: string, agentId: string): string {
  const base = (title || agentId || "worksheet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || "worksheet"}-${stamp}`;
}
