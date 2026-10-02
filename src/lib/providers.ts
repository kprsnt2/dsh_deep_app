import type { ProviderId } from "@/config/models";

/** A single piece of content inside a user turn. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; dataBase64: string }
  | { type: "document"; mimeType: string; dataBase64: string; name: string };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  parts: ContentPart[];
}

export interface RouteRequest {
  /** Ordered tiers to attempt. */
  chain: { provider: ProviderId; model: string }[];
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Abort signal from the client disconnecting. */
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface RouteAttempt {
  provider: ProviderId;
  model: string;
  ok: boolean;
  /** Milliseconds spent on this tier. */
  ms: number;
  /** Error text when ok === false. */
  error?: string;
  /** HTTP status when the failure came from the provider. */
  status?: number;
}

export interface RouteResult {
  ok: boolean;
  text: string;
  /** Which tier actually produced the answer. */
  servedBy?: { provider: ProviderId; model: string };
  attempts: RouteAttempt[];
  /** Set when every tier failed. */
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Provider adapters                                                   */
/* ------------------------------------------------------------------ */

interface ProviderAdapter {
  /** Convert our neutral message format into the provider's wire format. */
  buildBody(
    model: string,
    systemPrompt: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
  ): unknown;
  endpoint(model: string): string;
  headers(apiKey: string): Record<string, string>;
  /** Pull the assistant text out of the provider's response JSON. */
  extractText(json: unknown): string;
}

/** Convert base64 to a data URL for OpenAI-style image parts. */
function dataUrl(mimeType: string, dataBase64: string): string {
  return `data:${mimeType};base64,${dataBase64}`;
}

/**
 * OpenAI-compatible adapter.
 * OpenAI, NVIDIA NIM and Groq all speak this same shape, so one adapter
 * serves all three - only the endpoint and model differ.
 */
function openAiCompatible(
  baseUrl: string,
  opts: { imagesAsDataUrl?: boolean } = {},
): ProviderAdapter {
  return {
    endpoint: () => baseUrl,
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (model, systemPrompt, messages, maxTokens, temperature) => ({
      model,
      max_completion_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => {
          // Plain text-only turn -> simple string content.
          const onlyText = m.parts.every((p) => p.type === "text");
          if (onlyText) {
            return {
              role: m.role,
              content: m.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
            };
          }
          const content = m.parts.map((p) => {
            if (p.type === "text") return { type: "text", text: p.text };
            if (p.type === "image" && opts.imagesAsDataUrl !== false) {
              return {
                type: "image_url",
                image_url: { url: dataUrl(p.mimeType, p.dataBase64) },
              };
            }
            // Documents are pre-converted to text upstream; if one arrives here
            // the provider cannot read it natively, so degrade to a note.
            if (p.type === "document") {
              return {
                type: "text",
                text: `[Attached file "${p.name}" could not be read natively by this model.]`,
              };
            }
            return { type: "text", text: "" };
          });
          return { role: m.role, content };
        }),
      ],
    }),
    extractText: (json: unknown) => {
      const j = json as {
        choices?: { message?: { content?: string | null } }[];
      };
      return j?.choices?.[0]?.message?.content ?? "";
    },
  };
}

/** Google Gemini adapter - different wire format from OpenAI. */
const geminiAdapter: ProviderAdapter = {
  endpoint: (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  headers: (apiKey) => ({
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  }),
  buildBody: (model, systemPrompt, messages, maxTokens, temperature) => ({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: m.parts.map((p) => {
        if (p.type === "text") return { text: p.text };
        if (p.type === "image") {
          return { inlineData: { mimeType: p.mimeType, data: p.dataBase64 } };
        }
        // Gemini reads PDFs natively.
        return { inlineData: { mimeType: p.mimeType, data: p.dataBase64 } };
      }),
    })),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  }),
  extractText: (json: unknown) => {
    const j = json as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (
      j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
    );
  },
};

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  // OPENAI_BASE_URL lets you point at a proxy, a gateway, or a mock in tests.
  // It is read at request time so env changes do not need a rebuild.
  openai: {
    ...openAiCompatible("https://api.openai.com/v1/chat/completions"),
    endpoint: () =>
      process.env.OPENAI_BASE_URL?.trim() ||
      "https://api.openai.com/v1/chat/completions",
  },
  nvidia: openAiCompatible(
    "https://integrate.api.nvidia.com/v1/chat/completions",
  ),
  groq: openAiCompatible("https://api.groq.com/openai/v1/chat/completions"),
  gemini: geminiAdapter,
};

const KEY_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  groq: "GROQ_API_KEY",
};

/** Read a provider key from the server environment. */
export function getProviderKey(provider: ProviderId): string | undefined {
  const v = process.env[KEY_ENV[provider]];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function listConfiguredProviders(): ProviderId[] {
  return (Object.keys(KEY_ENV) as ProviderId[]).filter((p) =>
    Boolean(getProviderKey(p)),
  );
}

/* ------------------------------------------------------------------ */
/* Failure classification                                              */
/* ------------------------------------------------------------------ */

/**
 * Decide whether a failure should advance to the next tier.
 * Almost everything should - the point of the chain is resilience.
 */
function isRetryable(status: number, body: string): boolean {
  // Auth and quota problems are per-provider, so another provider can help.
  if (status === 401 || status === 403 || status === 429) return true;
  // Model not found / bad request: this tier is misconfigured, try the next.
  if (status === 400 || status === 404) return true;
  // Provider-side errors.
  if (status >= 500) return true;
  // Some providers return 200 with an error payload.
  if (/quota|rate limit|overloaded|unavailable/i.test(body)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* The router                                                          */
/* ------------------------------------------------------------------ */

/**
 * Try each tier in order until one produces text.
 * Never throws for provider failures - returns a RouteResult describing
 * exactly what was tried, so the UI can show the user.
 */
export async function routeChat(req: RouteRequest): Promise<RouteResult> {
  const attempts: RouteAttempt[] = [];

  for (const tier of req.chain) {
    const started = Date.now();
    const apiKey = getProviderKey(tier.provider);

    if (!apiKey) {
      attempts.push({
        provider: tier.provider,
        model: tier.model,
        ok: false,
        ms: 0,
        error: `No API key configured (set ${KEY_ENV[tier.provider]}).`,
      });
      continue;
    }

    const adapter = ADAPTERS[tier.provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    // Propagate client disconnect to the in-flight provider request.
    const onAbort = () => controller.abort();
    req.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(adapter.endpoint(tier.model), {
        method: "POST",
        headers: adapter.headers(apiKey),
        body: JSON.stringify(
          adapter.buildBody(
            tier.model,
            req.systemPrompt,
            req.messages,
            req.maxTokens ?? 4096,
            req.temperature ?? 0.7,
          ),
        ),
        signal: controller.signal,
      });

      const raw = await res.text();

      if (!res.ok) {
        attempts.push({
          provider: tier.provider,
          model: tier.model,
          ok: false,
          ms: Date.now() - started,
          status: res.status,
          error: summarizeError(res.status, raw),
        });
        // Even a non-retryable-looking error should fall through, because the
        // next provider may well succeed. Only stop for a client abort.
        if (req.signal?.aborted) break;
        continue;
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        attempts.push({
          provider: tier.provider,
          model: tier.model,
          ok: false,
          ms: Date.now() - started,
          status: res.status,
          error: "Provider returned a non-JSON response.",
        });
        continue;
      }

      const text = adapter.extractText(json).trim();

      if (!text) {
        attempts.push({
          provider: tier.provider,
          model: tier.model,
          ok: false,
          ms: Date.now() - started,
          status: res.status,
          error: "Provider returned an empty response.",
        });
        continue;
      }

      attempts.push({
        provider: tier.provider,
        model: tier.model,
        ok: true,
        ms: Date.now() - started,
      });

      return {
        ok: true,
        text,
        servedBy: { provider: tier.provider, model: tier.model },
        attempts,
      };
    } catch (err) {
      const aborted = controller.signal.aborted;
      const clientGone = req.signal?.aborted ?? false;
      attempts.push({
        provider: tier.provider,
        model: tier.model,
        ok: false,
        ms: Date.now() - started,
        error: clientGone
          ? "Cancelled by user."
          : aborted
            ? `Timed out after ${req.timeoutMs}ms.`
            : err instanceof Error
              ? err.message
              : "Unknown network error.",
      });
      if (clientGone) break;
      if (!isRetryable(0, "")) continue;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }
  }

  const configured = listConfiguredProviders();
  const error =
    configured.length === 0
      ? "No API keys are configured on the server. Add at least one key to your .env file and restart."
      : `All ${attempts.length} model tier(s) failed. Last error: ${
          attempts[attempts.length - 1]?.error ?? "unknown"
        }`;

  return { ok: false, text: "", attempts, error };
}

/** Turn a provider error body into one short readable line. */
function summarizeError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const msg =
      typeof j.error === "string"
        ? j.error
        : (j.error?.message ?? j.message ?? body);
    return `HTTP ${status}: ${String(msg).slice(0, 300)}`;
  } catch {
    return `HTTP ${status}: ${body.slice(0, 300)}`;
  }
}
