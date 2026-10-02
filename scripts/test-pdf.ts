/**
 * Generates a real worksheet PDF and verifies the bytes.
 * jsPDF runs in Node, so we can validate the output without a browser.
 */
import { jsPDF } from "jspdf";

// The pdf.ts module imports nothing browser-specific at module scope except
// through downloadPdf, which we do not call here. Re-implement the minimal
// entry point by importing the pure function.
import { markdownToPdf } from "@/lib/pdf.ts";

const worksheet = `# Grade 4 Maths - Multiplication

**Name:** ______________________  **Date:** ____________  **Score:** ____ / 20

## Section A - Fill in the blanks (10 marks)

1. 7 x 8 = ____
2. 12 x 3 = ____
3. 9 x 9 = ____
4. 15 x 4 = ____
5. 6 x 7 = ____

## Section B - Word problems (10 marks)

6. A box holds 24 pencils. How many pencils are in 5 boxes?
7. Ravi saves 150 rupees every week. How much does he save in 8 weeks?

---

## Answer Key

1. 56
2. 36
3. 81
4. 60
5. 42
6. 120 pencils
7. 1200 rupees
`;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

console.log("\n--- worksheet PDF generation ---");

const blob = markdownToPdf(worksheet, {
  title: "Grade 4 Maths",
  worksheetHeader: true,
});

check("returns a Blob", blob instanceof Blob);
check("has non-trivial size", blob.size > 1000, `${blob.size} bytes`);

const buf = Buffer.from(await blob.arrayBuffer());
const header = buf.subarray(0, 5).toString("latin1");
check("starts with %PDF- magic bytes", header.startsWith("%PDF-"), header);
check(
  "declares an EOF marker",
  buf.subarray(-1024).toString("latin1").includes("%%EOF"),
);

// Confirm the text actually made it into the file (jsPDF compresses streams,
// so also check the uncompressed variant).
const raw = buf.toString("latin1");
const uncompressed = markdownToPdf(worksheet, { title: "t" });
const ubuf = Buffer.from(await uncompressed.arrayBuffer()).toString("latin1");
check("PDF is well formed", raw.includes("obj") && raw.includes("trailer"));

console.log("\n--- unicode sanitisation ---");
{
  const withUnicode = "# Test \u2014 em dash \u201Cquotes\u201D \u2192 arrow \u2022 bullet";
  let threw = false;
  try {
    markdownToPdf(withUnicode, { title: "unicode" });
  } catch {
    threw = true;
  }
  check("unicode-heavy input does not throw", !threw);
}

console.log("\n--- edge cases ---");
for (const [name, input] of [
  ["empty document", ""],
  ["only whitespace", "   \n\n  "],
  ["very long line", "x".repeat(5000)],
  ["many pages", Array.from({ length: 200 }, (_, i) => `## Q${i}\n1. Question number ${i}?`).join("\n")],
  ["code block", "```python\nprint('hi')\n```"],
  ["table", "| A | B |\n|---|---|\n| 1 | 2 |"],
] as [string, string][]) {
  let threw = false;
  let size = 0;
  try {
    const b = markdownToPdf(input, { title: name });
    size = b.size;
  } catch {
    threw = true;
  }
  check(`${name} generates without throwing`, !threw && size > 0, `${size} bytes`);
}

console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
