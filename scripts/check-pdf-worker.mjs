/**
 * Preflight: is the PDF.js worker actually going to be served?
 *
 * src/lib/pdf-worker.ts asks pdf.js for `/pdf.worker.min.mjs` so heavy PDF
 * parsing runs off the main thread. Next.js only serves files that live under
 * `public/` (and it does NOT serve arbitrary `node_modules` paths), so the
 * file has to be copied there.
 *
 * Exits 0 and does nothing when the file is present. Otherwise it copies it
 * from pdfjs-dist (which is what `pnpm preflight` is for — e.g. after a
 * pdfjs-dist upgrade).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "pdf.worker.min.mjs");

const require = createRequire(join(root, "package.json"));
let source;
try {
  source = join(
    dirname(require.resolve("pdfjs-dist/package.json")),
    "build",
    "pdf.worker.min.mjs",
  );
} catch {
  console.error("pdfjs-dist is not installed. Run `pnpm install` first.");
  process.exit(1);
}

if (existsSync(target)) {
  console.log("✓ public/pdf.worker.min.mjs is present");
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(`✗ worker not found in pdfjs-dist at ${source}`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("✓ copied public/pdf.worker.min.mjs from pdfjs-dist");
console.log("  Commit it — without it, PDF parsing falls back to the main thread.");
