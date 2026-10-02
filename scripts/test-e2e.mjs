/**
 * End-to-end test: runs the real server, points the OpenAI adapter at a local
 * mock that speaks the OpenAI wire format, and verifies the full pipeline
 * (passcode -> routing -> attachment handling -> response) works.
 *
 * This proves the app functions against a real HTTP API, not just in unit tests.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const MOCK_PORT = 4599;
const APP_PORT = 3113;
const PASSCODE = "e2e-passcode";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

/* ---------- mock OpenAI-compatible provider ---------- */
const seen = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization ?? "";
    if (!auth.includes("mock-good-key")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }

    // Reject the deliberately-bad model so we can prove fallback works.
    if (parsed.model === "does-not-exist") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "model not found" } }));
      return;
    }

    seen.push(parsed);

    // Count image parts so the test can assert attachments survived the trip.
    const imageParts = (parsed.messages ?? []).flatMap((m) =>
      Array.isArray(m.content) ? m.content.filter((c) => c.type === "image_url") : [],
    ).length;
    const systemSeen = (parsed.messages ?? []).find((m) => m.role === "system");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: `MOCK_REPLY model=${parsed.model} images=${imageParts} systemLen=${systemSeen?.content?.length ?? 0}`,
            },
          },
        ],
      }),
    );
  });
});

await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
console.log(`Mock provider listening on ${MOCK_PORT}`);

/* ---------- start the real app ---------- */
const nodeExe = process.execPath;
const app = spawn(
  nodeExe,
  ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
  {
    env: {
      ...process.env,
      APP_PASSCODE: PASSCODE,
      OPENAI_API_KEY: "mock-good-key",
      // Point the OpenAI adapter at our mock instead of api.openai.com.
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`,
      GEMINI_API_KEY: "",
      NVIDIA_API_KEY: "",
      GROQ_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

// Wait for the server to accept connections.
const base = `http://127.0.0.1:${APP_PORT}`;
let up = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`${base}/api/config`);
    if (r.ok) { up = true; break; }
  } catch { /* not ready yet */ }
}
check("app server started", up);

const post = async (body, headers = {}) => {
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const AUTH = { "x-app-passcode": PASSCODE };
const textTurn = (t) => [{ role: "user", parts: [{ type: "text", text: t }] }];

console.log("\n--- passcode gate ---");
{
  const r = await post({ agentId: "general", messages: textTurn("hi") });
  check("rejects missing passcode with 401", r.status === 401, `got ${r.status}`);
}
{
  const r = await post({ agentId: "general", messages: textTurn("hi") }, { "x-app-passcode": "nope" });
  check("rejects wrong passcode with 401", r.status === 401, `got ${r.status}`);
}

console.log("\n--- happy path ---");
{
  const r = await post({ agentId: "general", messages: textTurn("hello") }, AUTH);
  check("returns 200 with a valid passcode", r.status === 200, `got ${r.status}`);
  check("response contains mock text", r.json?.text?.startsWith("MOCK_REPLY"), r.json?.text);
  check("reports which provider served it", r.json?.servedBy?.provider === "openai", JSON.stringify(r.json?.servedBy));
}

console.log("\n--- the agent's system prompt is actually sent ---");
{
  const r = await post({ agentId: "kidstory", messages: textTurn("a story") }, AUTH);
  check("kidstory request succeeds", r.status === 200);
  const m = r.json?.text?.match(/systemLen=(\d+)/);
  const len = m ? Number(m[1]) : 0;
  check("kidstory has a substantial system prompt", len > 400, `len=${len}`);
}

console.log("\n--- image attachments reach the provider ---");
{
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ).toString("base64");

  const r = await post(
    {
      agentId: "doctor",
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "read this prescription" },
            { type: "image", mimeType: "image/png", dataBase64: png },
          ],
        },
      ],
    },
    AUTH,
  );
  check("image request succeeds", r.status === 200, r.json?.error);
  check("image survived the round trip", r.json?.text?.includes("images=1"), r.json?.text);
}

console.log("\n--- multiple images in one message (the core use case) ---");
{
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ).toString("base64");

  const parts = [{ type: "text", text: "12 prescription pages" }];
  for (let i = 0; i < 12; i++) {
    parts.push({ type: "image", mimeType: "image/png", dataBase64: png });
  }
  const r = await post({ agentId: "doctor", messages: [{ role: "user", parts }] }, AUTH);
  check("12 images accepted in one message", r.status === 200, r.json?.error);
  check("all 12 images reached the provider", r.json?.text?.includes("images=12"), r.json?.text);
}

console.log("\n--- image limit is enforced ---");
{
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ).toString("base64");
  const parts = [{ type: "text", text: "too many" }];
  for (let i = 0; i < 25; i++) parts.push({ type: "image", mimeType: "image/png", dataBase64: png });
  const r = await post({ agentId: "doctor", messages: [{ role: "user", parts }] }, AUTH);
  check("25 images rejected with 413", r.status === 413, `got ${r.status}`);
}

console.log("\n--- privacy mode routes to Gemini, not OpenAI ---");
{
  // Gemini has no key in this test env, so it must fail and NOT silently
  // use the working OpenAI mock as the *first* choice.
  const r = await post(
    { agentId: "general", privacyMode: true, messages: textTurn("private") },
    AUTH,
  );
  const firstAttempt = r.json?.attempts?.[0];
  check(
    "first tier attempted is Gemini in privacy mode",
    firstAttempt?.provider === "gemini",
    JSON.stringify(firstAttempt),
  );
  check(
    "soft fallback then reaches a training provider",
    r.json?.attempts?.some((a) => a.provider === "openai"),
  );
  check(
    "privacy compromise is flagged to the user",
    r.json?.privacyCompromised === true,
    JSON.stringify({ pc: r.json?.privacyCompromised, w: r.json?.warnings }),
  );
  check(
    "a red privacy warning is present",
    (r.json?.warnings ?? []).some((w) => w.startsWith("PRIVACY WARNING")),
    JSON.stringify(r.json?.warnings),
  );
}

console.log("\n--- Doctor is private even with the toggle OFF ---");
{
  const r = await post({ agentId: "doctor", privacyMode: false, messages: textTurn("report") }, AUTH);
  check(
    "doctor's first tier is Gemini despite toggle off",
    r.json?.attempts?.[0]?.provider === "gemini",
    JSON.stringify(r.json?.attempts?.[0]),
  );
}

console.log("\n--- validation ---");
{
  const r = await post({ agentId: "general", messages: [] }, AUTH);
  check("empty messages rejected with 400", r.status === 400, `got ${r.status}`);
}
{
  const r = await post({ agentId: "no-such-agent", messages: textTurn("x") }, AUTH);
  check("unknown agent returns an error", r.json?.ok === false);
  check("unknown agent error is descriptive", /unknown agent/i.test(r.json?.error ?? ""), r.json?.error);
}

/* ---------- teardown ---------- */
app.kill();
mock.close();

console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
