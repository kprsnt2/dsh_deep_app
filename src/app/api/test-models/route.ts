import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CHAIN, PRIVACY_CHAIN, PROVIDERS, type ProviderId } from "@/config/models";
import { getProviderKey } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Providers that expose a list-models endpoint we can query. */
const LIST_URL: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  nvidia: "https://integrate.api.nvidia.com/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

/**
 * Ask each configured provider which models it actually offers.
 * This is how you verify whether IDs like "gpt-5.4-mini" exist before
 * trusting the default chain.
 */
export async function GET(req: NextRequest) {
  const required = process.env.APP_PASSCODE?.trim();
  if (required && (req.headers.get("x-app-passcode") ?? "") !== required) {
    return NextResponse.json({ ok: false, error: "Unauthorised." }, { status: 401 });
  }

  const wanted = [...DEFAULT_CHAIN, ...PRIVACY_CHAIN];
  const results: Record<
    string,
    { configured: boolean; reachable: boolean; error?: string; models?: string[] }
  > = {};

  for (const provider of Object.keys(LIST_URL) as ProviderId[]) {
    const key = getProviderKey(provider);
    if (!key) {
      results[provider] = { configured: false, reachable: false };
      continue;
    }
    const url = LIST_URL[provider]!;
    try {
      const res = await fetch(url, {
        headers:
          provider === "gemini"
            ? { "x-goog-api-key": key }
            : { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        results[provider] = {
          configured: true,
          reachable: false,
          error: `HTTP ${res.status}`,
        };
        continue;
      }
      const json = (await res.json()) as {
        data?: { id?: string }[];
        models?: { name?: string }[];
      };
      const fromData: string[] = (json.data ?? []).map((m) => m.id ?? "");
      const fromModels: string[] = (json.models ?? []).map((m) => m.name ?? "");
      const ids = [...fromData, ...fromModels]
        .filter(Boolean)
        .map((n) => n.replace(/^models\//, ""));
      results[provider] = { configured: true, reachable: true, models: ids };
    } catch (err) {
      results[provider] = {
        configured: true,
        reachable: false,
        error: err instanceof Error ? err.message : "network error",
      };
    }
  }

  // For each tier in our chain, say whether the provider lists that exact model.
  const tiers = wanted.map((t) => {
    const r = results[t.provider];
    const listed = r?.models?.includes(t.model) ?? false;
    return {
      provider: t.provider,
      providerLabel: PROVIDERS[t.provider].label,
      model: t.model,
      label: t.label,
      configured: r?.configured ?? false,
      providerReachable: r?.reachable ?? false,
      /** null = unknown (provider not listable), true/false otherwise. */
      modelListed: r?.models ? listed : null,
      suggestion: r?.models && !listed ? closestMatch(t.model, r.models) : null,
    };
  });

  return NextResponse.json({ ok: true, tiers, providers: results });
}

/** Find the closest available model ID, to suggest a correction. */
function closestMatch(target: string, available: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = norm(target);
  const tokenOf = (s: string) => s.split(/[^a-z0-9]+/i).filter((x) => x.length > 1);

  // 1. Exact after normalisation.
  const exact = available.find((m) => norm(m) === t);
  if (exact) return exact;

  // 2. Highest token overlap, preferring shorter (more specific) names.
  const targetTokens = new Set(tokenOf(target));
  let best: { m: string; score: number } | null = null;
  for (const m of available) {
    const tokens = tokenOf(m);
    const overlap = tokens.filter((x) => targetTokens.has(x.toLowerCase())).length;
    if (overlap === 0) continue;
    const score = overlap * 100 - m.length;
    if (!best || score > best.score) best = { m, score };
  }
  return best?.m ?? null;
}
