/**
 * Routing tests. Run with:
 *   node --experimental-strip-types scripts/test-routing.ts
 * or via the compiled path in CI.
 *
 * These assert the privacy guarantees, which are the part of the app most
 * costly to get wrong.
 */
import { buildChain } from "../src/lib/router.ts";
import { PRIVACY_ALLOW_SOFT_FALLBACK } from "../src/config/models.ts";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const base = {
  agentId: "general",
  forcedModel: null,
  privacyMode: false,
  messages: [],
};

console.log("\n--- default routing ---");
{
  const r = buildChain({ ...base });
  check("standard mode starts with OpenAI", r.chain[0].provider === "openai");
  check("standard mode has all 5 tiers", r.chain.length === 5, `got ${r.chain.length}`);
  check("standard mode is not private", r.privacyEnforced === false);
}

console.log("\n--- privacy mode: Gemini must be first ---");
{
  const r = buildChain({ ...base, privacyMode: true });
  check("privacy mode enforces privacy", r.privacyEnforced === true);
  check("privacy mode starts with Gemini", r.chain[0].provider === "gemini", r.chain[0].provider);
  check(
    "Gemini precedes OpenAI in privacy mode",
    r.chain.findIndex((t) => t.provider === "gemini") <
      (r.chain.findIndex((t) => t.provider === "openai") === -1
        ? Number.MAX_SAFE_INTEGER
        : r.chain.findIndex((t) => t.provider === "openai")),
  );
  if (!PRIVACY_ALLOW_SOFT_FALLBACK) {
    check(
      "hard block: no training provider present",
      r.chain.every((t) => t.provider === "gemini"),
      JSON.stringify(r.chain),
    );
  } else {
    console.log("  (soft fallback enabled - training providers appended last)");
  }
}

console.log("\n--- sensitive agents are private even with the toggle OFF ---");
for (const agentId of ["doctor", "psycho"]) {
  const r = buildChain({ ...base, agentId, privacyMode: false });
  check(`${agentId} forces private routing`, r.privacyEnforced === true);
  check(`${agentId} starts with Gemini`, r.chain[0].provider === "gemini", r.chain[0].provider);
}

console.log("\n--- non-sensitive agents stay standard ---");
for (const agentId of ["kidstory", "studybuddy", "worksheet", "general"]) {
  const r = buildChain({ ...base, agentId, privacyMode: false });
  check(`${agentId} is not forced private`, r.privacyEnforced === false);
}

console.log("\n--- forced model selection ---");
{
  const r = buildChain({ ...base, forcedModel: "gemini:gemini-flash-latest" });
  check("forced model is honoured", r.chain[0].model === "gemini-flash-latest");
}
{
  const r = buildChain({
    ...base,
    forcedModel: "openai:gpt-5.4-mini",
    privacyMode: true,
  });
  check("forced OpenAI under privacy warns the user", r.warnings.length > 0);
  check(
    "forced OpenAI under privacy keeps Gemini as a fallback",
    r.chain.some((t) => t.provider === "gemini"),
  );
}
{
  const r = buildChain({ ...base, forcedModel: "bogus" });
  check("malformed forced model falls back to default chain", r.chain[0].provider === "openai");
  check("malformed forced model warns", r.warnings.length > 0);
}

console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);

process.exit(fail === 0 ? 0 : 1);
