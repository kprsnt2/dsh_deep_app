/**
 * A small, dependency-free Markdown renderer.
 *
 * Why not a library: we only need headings, lists, bold/italic, code,
 * tables and rules. Rolling it here keeps the bundle small and, crucially,
 * lets us control escaping so model output can never inject HTML.
 */

/** Escape HTML so model output is always treated as text, never markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline formatting: code, bold, italic, links. Input must be escaped first. */
function inline(text: string): string {
  let s = text;

  // Inline code first so its contents are not further formatted.
  const codeSlots: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSlots.push(`<code class="md-code">${code}</code>`);
    return `\u0000CODE${codeSlots.length - 1}\u0000`;
  });

  s = s
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Links: only http(s), to avoid javascript: URLs.
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>',
  );

  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => codeSlots[Number(i)]);
  return s;
}

interface TableState {
  inTable: boolean;
  headerDone: boolean;
}

/** Render Markdown to safe HTML. */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const table: TableState = { inTable: false, headerDone: false };

  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const closeTable = () => {
    if (table.inTable) {
      out.push("</tbody></table>");
      table.inTable = false;
      table.headerDone = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ---- fenced code blocks ----
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      if (!inCode) {
        closeList();
        closeTable();
        inCode = true;
        codeLang = fence[1] || "";
        codeBuf = [];
      } else {
        out.push(
          `<pre class="md-pre"><div class="md-pre-head">${escapeHtml(codeLang || "code")}</div><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // ---- tables ----
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const isSeparator = /^\s*\|[\s:|-]+\|\s*$/.test(line);

    if (isTableRow && !isSeparator) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());

      if (!table.inTable) {
        closeList();
        out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>');
        out.push(cells.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join(""));
        out.push("</tr></thead><tbody>");
        table.inTable = true;
        table.headerDone = false;
      } else {
        if (!table.headerDone) table.headerDone = true;
        out.push(
          `<tr>${cells.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`,
        );
      }
      continue;
    }
    if (isSeparator && table.inTable) {
      table.headerDone = true;
      continue;
    }
    closeTable();

    // ---- headings ----
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h${lvl}">${inline(escapeHtml(h[2]))}</h${lvl}>`);
      continue;
    }

    // ---- horizontal rule ----
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push('<hr class="md-hr" />');
      continue;
    }

    // ---- blockquote ----
    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      closeList();
      out.push(`<blockquote class="md-quote">${inline(escapeHtml(bq[1]))}</blockquote>`);
      continue;
    }

    // ---- lists ----
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want: "ul" | "ol" = ul ? "ul" : "ol";
      if (listType !== want) {
        closeList();
        out.push(`<${want} class="md-${want}">`);
        listType = want;
      }
      out.push(`<li>${inline(escapeHtml((ul ?? ol)![1]))}</li>`);
      continue;
    }

    // ---- blank line ----
    if (line.trim() === "") {
      closeList();
      continue;
    }

    // ---- paragraph ----
    closeList();
    out.push(`<p class="md-p">${inline(escapeHtml(line))}</p>`);
  }

  if (inCode && codeBuf.length) {
    out.push(`<pre class="md-pre"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  closeList();
  closeTable();

  return out.join("\n");
}
