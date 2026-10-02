/** Writes a sample worksheet PDF to ./sample-output for visual inspection. */
import { mkdirSync, writeFileSync } from "node:fs";
import { markdownToPdf } from "@/lib/pdf.ts";

const worksheet = `# Grade 4 Maths - Multiplication Practice

**Name:** ______________________________  **Date:** ____________________  **Score:** ______ / 20

## Section A - Fill in the blanks (10 marks)

1. 7 x 8 = ______________
2. 12 x 3 = ______________
3. 9 x 9 = ______________
4. 15 x 4 = ______________
5. 6 x 7 = ______________
6. 11 x 11 = ______________
7. 8 x 12 = ______________
8. 14 x 5 = ______________
9. 13 x 3 = ______________
10. 16 x 2 = ______________

## Section B - Word problems (10 marks)

11. A box holds 24 pencils. How many pencils are in 5 boxes?

    ________________________________________________________________

12. Ravi saves 150 rupees every week. How much does he save in 8 weeks?

    ________________________________________________________________

13. A classroom has 9 rows of desks with 6 desks in each row. How many desks are there?

    ________________________________________________________________

---

## Answer Key

1. 56
2. 36
3. 81
4. 60
5. 42
6. 121
7. 96
8. 70
9. 39
10. 32
11. 120 pencils
12. 1200 rupees
13. 54 desks
`;

mkdirSync("sample-output", { recursive: true });
const blob = markdownToPdf(worksheet, {
  title: "Grade 4 Maths - Multiplication Practice",
  worksheetHeader: true,
});
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync("sample-output/sample-worksheet.pdf", buf);
console.log(`Wrote sample-output/sample-worksheet.pdf (${buf.length} bytes)`);
