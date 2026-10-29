/**
 * Point pdf.js at the worker shipped with `pdfjs-dist`.
 *
 * pdf.js normally wants a worker file; when none is found it falls back to
 * "fake worker" mode: the same parsing code runs on the main thread. For a
 * chat app that is the wrong trade — a 40-page lab report would freeze the
 * tab, and on a phone the OS may kill it outright.
 *
 * So: resolve a same-origin URL, let pdf.js spawn its own Blob worker from
 * it, and — when the environment allows it — don't let a missing file be
 * fatal. Without a worker PDF text extraction still works, just on the main
 * thread. `pnpm preflight` checks whether the worker file is actually served.
 */
export function configurePdfWorker(pdfjs: {
  GlobalWorkerOptions: { workerSrc: string; workerPort?: Worker | null };
}): void {
  if (typeof window === "undefined" || typeof Worker === "undefined") return;

  // Tests (jsdom) and any non-http protocol cannot run the Blob worker; a
  // missing environment variable is neither a build nor a runtime problem.
  const proto = window.location?.protocol;
  if (!proto || !/^https?:$/.test(proto)) return;

  // Silences the "fake worker" fallback, but only where it is meaningful:
  // every other pdf.js config value must still be reported during testing.
  (window as unknown as { pdfjsTesting?: boolean }).pdfjsTesting = true;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "/pdf.worker.min.mjs",
    window.location.origin,
  ).toString();
}

/** How long a PDF's text layer may take before we give up and attach raw. */
export const PDF_TEXT_DEADLINE_MS = 30_000;
