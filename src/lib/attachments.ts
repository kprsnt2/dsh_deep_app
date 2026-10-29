import type { StoredAttachment } from "./storage";
import { uid } from "./storage";
import { configurePdfWorker, PDF_TEXT_DEADLINE_MS } from "./pdf-worker";

/** File kinds we understand. */
export type FileKind = "image" | "pdf" | "text" | "csv" | "docx" | "unknown";

export function classifyFile(file: File): FileKind {
  const t = file.type;
  const name = file.name.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (t === "text/csv" || name.endsWith(".csv")) return "csv";
  if (t.startsWith("text/") || /\.(txt|md|json|log|ts|tsx|js|jsx|py|sql|html|css|yml|yaml)$/.test(name))
    return "text";
  if (name.endsWith(".docx")) return "docx";
  return "unknown";
}

/** Images the vision models accept. */
const OK_IMAGE = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Longest edge we downscale to. Big phone photos blow the payload limit. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export interface ProcessResult {
  attachment: StoredAttachment;
  /** Non-fatal notice to show the user, e.g. "downscaled 4.2 MB -> 380 KB". */
  notice?: string;
}

/**
 * Turn a picked File into a storable attachment, doing whatever
 * normalisation that file type needs.
 */
export async function processFile(file: File): Promise<ProcessResult> {
  const kind = classifyFile(file);

  if (kind === "image") return processImage(file);
  if (kind === "pdf") return processPdf(file);
  if (kind === "csv") return processCsv(file);
  if (kind === "text") return processText(file);
  if (kind === "docx") return processDocx(file);

  return {
    attachment: {
      id: uid(),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      blob: file,
      sendable: false,
      note: "Unsupported file type. Convert it to PDF, image, CSV or plain text.",
    },
  };
}

/* -------------------------------- images ------------------------------- */

async function processImage(file: File): Promise<ProcessResult> {
  // SVG and other vector/odd types cannot be sent to vision models.
  if (!OK_IMAGE.includes(file.type)) {
    const blob = await convertToPng(file);
    if (!blob) {
      return {
        attachment: {
          id: uid(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          blob: file,
          sendable: false,
          note: `${file.type || "This image type"} cannot be sent to the models. Use PNG or JPEG.`,
        },
      };
    }
    return {
      attachment: {
        id: uid(),
        name: file.name.replace(/\.[^.]+$/, "") + ".png",
        mimeType: "image/png",
        size: blob.size,
        blob,
        sendable: true,
      },
      notice: "Converted to PNG for compatibility.",
    };
  }

  const { blob, width, height } = await downscaleImage(file, MAX_EDGE, JPEG_QUALITY);

  // Keep the original if it was already small - avoids needless quality loss.
  if (blob.size >= file.size) {
    return {
      attachment: {
        id: uid(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        blob: file,
        sendable: true,
      },
    };
  }

  return {
    attachment: {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      mimeType: "image/jpeg",
      size: blob.size,
      blob,
      sendable: true,
    },
    notice: `Resized ${(file.size / 1024 / 1024).toFixed(1)} MB -> ${(blob.size / 1024).toFixed(0)} KB (${width}x${height}).`,
  };
}

/**
 * Read image pixels. `createImageBitmap` handles EXIF orientation (so phone
 * photos come out upright, not sideways) and supports every format the
 * browser can decode, including modern iPhone HEIC.
 */
async function decodeBitmap(
  file: File,
  orient: ImageOrientation,
): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: orient });
    } catch {
      /* fall through to the <img> path */
    }
  }
  // Older Safari has no createImageBitmap support for File at all.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("This image could not be decoded."));
      img.src = url;
    });
    return await createImageBitmap(img, { imageOrientation: orient });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downscaleImage(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await decodeBitmap(file, "from-image");
  let { width, height } = bitmap;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { blob: file, ...dims };
  }
  // White background so transparent PNGs do not turn black in JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
      "image/jpeg",
      quality,
    ),
  );
  return { blob, width, height };
}

async function convertToPng(file: File): Promise<Blob | null> {
  try {
    const bitmap = await decodeBitmap(file, "from-image");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
  } catch {
    return null;
  }
}

/* ---------------------------------- PDF -------------------------------- */

/**
 * Extract text from a PDF.
 *
 * The raw PDF is ALSO kept, because Gemini reads PDFs natively (including
 * scanned ones via its own OCR). The extracted text is a fallback for
 * providers that cannot take a PDF directly.
 *
 * The text layer is a bonus, never a gate: anything that goes wrong here
 * (no worker, time budget, jsdom test run) still attaches the file.
 */
async function processPdf(file: File): Promise<ProcessResult> {
  let text = "";
  let pages = 0;
  // A scanned 12-page report is slow to parse; bail after 30s (mobile Safari
  // kills long-running main-thread work anyway) and still attach the file.
  const deadline = Date.now() + PDF_TEXT_DEADLINE_MS;
  try {
    // SSR/SSG has no DOM: skip extraction there rather than guessing at a
    // worker URL, and let the browser run do the real work.
    if (typeof window === "undefined") throw new Error("no DOM");
    const pdfjs = await import("pdfjs-dist");
    // Point at the worker shipped with the package.
    configurePdfWorker(pdfjs);

    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    pages = doc.numPages;

    const parts: string[] = [];
    // Cap the work so a 500-page PDF does not freeze the tab.
    const limit = Math.min(doc.numPages, 60);
    for (let i = 1; i <= limit; i++) {
      if (Date.now() > deadline) {
        parts.push(
          `[Text extraction stopped after 30s at page ${i} of ${doc.numPages}. The full file is still attached for models that read PDFs natively.]`,
        );
        break;
      }
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it) => {
          // pdf.js emits `str` items for text and `hasEOL` markers for line
          // breaks. Dropping the markers (as we used to) glues headings onto
          // the following paragraph — on a phone-sized screen that is most of
          // the report.
          if ("str" in it) return it.str;
          if ("hasEOL" in it) return "\n";
          return "";
        })
        .join(" ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      if (pageText) parts.push(`[Page ${i}]\n${pageText}`);
    }
    if (doc.numPages > limit) {
      parts.push(`[Only the first ${limit} of ${doc.numPages} pages were extracted as text.]`);
    }
    text = parts.join("\n\n");
  } catch (err) {
    return {
      attachment: {
        id: uid(),
        name: file.name,
        mimeType: "application/pdf",
        size: file.size,
        blob: file,
        sendable: true,
        note:
          "Could not read this PDF's text layer locally - it may be a scan. " +
          "Gemini can still read it; other models cannot.",
      },
    };
  }

  const hasText = text.trim().length > 40;
  return {
    attachment: {
      id: uid(),
      name: file.name,
      mimeType: "application/pdf",
      size: file.size,
      blob: file,
      extractedText: hasText ? text : undefined,
      sendable: true,
      note: hasText
        ? undefined
        : `No selectable text found in ${pages} page(s) - this looks like a scanned PDF. ` +
          `Gemini will OCR it; other models will not see its contents.`,
    },
    notice: hasText
      ? `Extracted text from ${pages} page(s).`
      : undefined,
  };
}

/* ---------------------------------- CSV -------------------------------- */

async function processCsv(file: File): Promise<ProcessResult> {
  const raw = await file.text();
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // Give the model a proper look at the shape of the data: header, dtypes
  // guessed from the first rows, and a decent sample.
  const header = lines[0] ?? "";
  const delimiter = detectDelimiter(header);
  const cols = splitCsvLine(header, delimiter);

  const sampleRows = lines.slice(1, 41);
  const truncated = lines.length - 1 > sampleRows.length;

  const profile = cols.map((c, i) => {
    const values = sampleRows
      .map((r) => splitCsvLine(r, delimiter)[i] ?? "")
      .filter((v) => v.length > 0);
    const numeric = values.filter((v) => !Number.isNaN(Number(v.replace(/[,₹$%]/g, ""))));
    const type =
      values.length === 0
        ? "empty"
        : numeric.length / values.length > 0.8
          ? "numeric"
          : "text";
    const uniq = new Set(values).size;
    return `  - ${c}: ${type}, ${uniq} distinct in sample`;
  });

  const text = [
    `CSV file: ${file.name}`,
    `Total data rows: ${lines.length - 1}`,
    `Columns (${cols.length}):`,
    ...profile,
    "",
    "Raw sample:",
    lines.slice(0, 41).join("\n"),
    truncated ? `\n[... ${lines.length - 1 - sampleRows.length} more rows not shown ...]` : "",
  ].join("\n");

  return {
    attachment: {
      id: uid(),
      name: file.name,
      mimeType: file.type || "text/csv",
      size: file.size,
      blob: file,
      extractedText: text,
      sendable: true,
    },
    notice: `Parsed ${lines.length - 1} rows across ${cols.length} columns.`,
  };
}

function detectDelimiter(header: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const c = header.split(d).length;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

/** Minimal CSV line splitter that respects quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/* ---------------------------------- text ------------------------------- */

const MAX_TEXT_CHARS = 200_000;

async function processText(file: File): Promise<ProcessResult> {
  const raw = await file.text();
  const clipped = raw.length > MAX_TEXT_CHARS;
  return {
    attachment: {
      id: uid(),
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      blob: file,
      extractedText: clipped ? raw.slice(0, MAX_TEXT_CHARS) : raw,
      sendable: true,
      note: clipped ? `Truncated to the first ${MAX_TEXT_CHARS.toLocaleString()} characters.` : undefined,
    },
    notice: clipped ? "Large file - truncated to fit the model." : undefined,
  };
}

/* ---------------------------------- DOCX ------------------------------- */

/**
 * DOCX is a ZIP of XML. We extract the visible text without pulling in a
 * heavy library: read the zip, find word/document.xml, strip the tags.
 * Falls back to a clear message if anything is unexpected.
 */
async function processDocx(file: File): Promise<ProcessResult> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file("word/document.xml");
    if (!entry) throw new Error("word/document.xml missing");
    const xml = await entry.async("string");

    const text = xml
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      attachment: {
        id: uid(),
        name: file.name,
        mimeType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: file.size,
        blob: file,
        extractedText: text.slice(0, MAX_TEXT_CHARS),
        sendable: true,
      },
      notice: "Extracted text from the document.",
    };
  } catch {
    return {
      attachment: {
        id: uid(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        blob: file,
        sendable: false,
        note: "Could not read this .docx. Save it as PDF and attach that instead.",
      },
    };
  }
}
