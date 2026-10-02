/**
 * Tests the Markdown renderer, focusing on XSS safety and worksheet layout.
 */
import { renderMarkdown, escapeHtml } from "@/lib/markdown.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

console.log("\n--- escaping / XSS safety ---");
{
  const evil = '<script>alert("xss")</script>';
  const out = renderMarkdown(evil);
  check("script tags are escaped", !out.includes("<script>"), out);
  check("escaped text is preserved", out.includes("&lt;script&gt;"), out);
}
{
  const img = '![x](javascript:alert(1))';
  const out = renderMarkdown(img);
  check("javascript: URLs are not linkified", !out.includes('href="javascript:'), out);
}
{
  const out = renderMarkdown('[ok](https://example.com)');
  check("https links are rendered", out.includes('href="https://example.com"'), out);
}
{
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  check("img onerror is escaped", !out.includes("<img"), out);
}

console.log("\n--- structure ---");
{
  const out = renderMarkdown("# Title\n\nSome **bold** text.");
  check("h1 rendered", out.includes("<h1"), out);
  check("bold rendered", out.includes("<strong>bold</strong>"), out);
}
{
  const out = renderMarkdown("- one\n- two");
  check("unordered list rendered", out.includes("<ul") && out.includes("<li>"), out);
}
{
  const out = renderMarkdown("1. first\n2. second");
  check("ordered list rendered", out.includes("<ol"), out);
}
{
  const out = renderMarkdown("```js\nconst a = 1;\n```");
  check("code fence rendered", out.includes("<pre") && out.includes("const a = 1;"), out);
  check("code language label shown", out.includes("js"), out);
}
{
  const out = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
  check("table rendered", out.includes("<table") && out.includes("<th>A</th>"), out);
  check("table body rendered", out.includes("<td>1</td>"), out);
}
{
  const out = renderMarkdown("---");
  check("horizontal rule rendered", out.includes("<hr"), out);
}
{
  const out = renderMarkdown("> quoted");
  check("blockquote rendered", out.includes("<blockquote"), out);
}
{
  // A realistic worksheet shape must survive intact.
  const ws = `# Grade 4 Maths
**Name:** ______  **Date:** ______

## Section A - Multiplication (10 marks)
1. 7 x 8 = ____
2. 12 x 3 = ____

## Answer Key
1. 56
2. 36`;
  const out = renderMarkdown(ws);
  check("worksheet h1 survives", out.includes("Grade 4 Maths"));
  check("worksheet sections survive", out.includes("Section A"));
  check("answer key survives", out.includes("Answer Key"));
  check("blanks survive", out.includes("____"), out);
}

console.log("\n--- edge cases ---");
check("empty string does not throw", renderMarkdown("") === "");
check("unclosed code fence does not throw", renderMarkdown("```js\nabc").includes("<pre"));
check("escapeHtml handles ampersand", escapeHtml("a & b") === "a &amp; b");
check("escapeHtml handles quotes", escapeHtml('"x"') === "&quot;x&quot;");

console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
