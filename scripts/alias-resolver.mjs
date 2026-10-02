/**
 * Resolver for running the app's TypeScript modules directly under plain Node.
 * Handles two things Next.js does that Node does not:
 *   1. the "@/x" path alias  ->  <repo>/src/x
 *   2. extensionless relative imports  ->  append ".ts" / "/index.ts"
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolvePath(here, "..", "src");

/** Try candidate extensions for an extensionless specifier. */
function withExtension(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    resolvePath(basePath, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = resolvePath(SRC, specifier.slice(2));
    const found = withExtension(base);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const base = resolvePath(parentDir, specifier);
    if (!existsSync(base)) {
      const found = withExtension(base);
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
  }

  return nextResolve(specifier, context);
}
