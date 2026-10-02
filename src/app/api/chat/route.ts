import { NextRequest, NextResponse } from "next/server";
import { handleChat, type ChatRequestBody } from "@/lib/router";
import { MAX_ATTACHMENT_MB, MAX_IMAGES_PER_MESSAGE } from "@/config/models";

export const runtime = "nodejs";
/** Allow long multi-tier fallback chains. */
export const maxDuration = 300;

/** Constant-time-ish string comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorised. Enter the app passcode." },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  // ---- passcode gate -------------------------------------------------
  const required = process.env.APP_PASSCODE?.trim();
  if (required) {
    const supplied = req.headers.get("x-app-passcode") ?? "";
    if (!safeEqual(supplied, required)) return unauthorized();
  }

  // ---- parse ---------------------------------------------------------
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed request body." },
      { status: 400 },
    );
  }

  if (!body?.agentId || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { ok: false, error: "agentId and a non-empty messages array are required." },
      { status: 400 },
    );
  }

  // ---- size guards ---------------------------------------------------
  let imageCount = 0;
  let totalBytes = 0;
  for (const m of body.messages) {
    for (const p of m.parts ?? []) {
      if (p.type === "image") imageCount++;
      if (p.type === "image" || p.type === "document") {
        // base64 is ~4/3 of raw size.
        totalBytes += (p.dataBase64.length * 3) / 4;
      }
    }
  }

  if (imageCount > MAX_IMAGES_PER_MESSAGE) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many images: ${imageCount}. The limit is ${MAX_IMAGES_PER_MESSAGE} per message.`,
      },
      { status: 413 },
    );
  }

  if (totalBytes > MAX_ATTACHMENT_MB * 1024 * 1024) {
    return NextResponse.json(
      {
        ok: false,
        error: `Attachments total ${(totalBytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_ATTACHMENT_MB} MB limit.`,
      },
      { status: 413 },
    );
  }

  // ---- route ---------------------------------------------------------
  try {
    const result = await handleChat(body, req.signal);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Server error: ${err.message}`
            : "Unknown server error.",
        attempts: [],
        warnings: [],
        privacyCompromised: false,
      },
      { status: 500 },
    );
  }
}
