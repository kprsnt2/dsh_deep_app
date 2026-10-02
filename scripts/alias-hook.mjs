/**
 * Node module-resolution hook that maps the "@/..." alias (used by Next.js)
 * onto the real src/ directory, so plain `node` can run our test scripts
 * without a bundler or a second copy of the path config.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-resolver.mjs", pathToFileURL("./scripts/"));
