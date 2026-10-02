import {
  DEFAULT_CHAIN,
  PRIVACY_CHAIN,
  PRIVACY_ALLOW_SOFT_FALLBACK,
  ALWAYS_PRIVATE_AGENTS,
  TIER_TIMEOUT_MS,
  type ModelTier,
  type ProviderId,
  PROVIDERS,
} from "@/config/models";
import { AGENT_BY_ID } from "@/config/agents";
import {
  routeChat,
  type ChatMessage,
  type ContentPart,
  type RouteResult,
} from "./providers";

export interface ChatRequestBody {
  agentId: string;
  /** Explicit tier override from the model picker, e.g. "openai:gpt-5.4-mini". */
  forcedModel?: string | null;
  /** User's Privacy Mode toggle. */
  privacyMode: boolean;
  /** When true, allow privacy chats to fall through to training providers. */
  allowSoftFallback?: boolean;
  messages: { role: "user" | "assistant"; parts: ContentPart[] }[];
}

export interface ChatResponseBody {
  ok: boolean;
  text: string;
  servedBy?: { provider: ProviderId; model: string };
  attempts: RouteResult["attempts"];
  error?: string;
  /** True when privacy content was sent to a provider that trains on data. */
  privacyCompromised: boolean;
  /** Human-readable warnings to show in the UI. */
  warnings: string[];
}

/** Parse "provider:model" into a tier. */
export function parseForcedModel(spec: string): {
  provider: ProviderId;
  model: string;
} | null {
  const idx = spec.indexOf(":");
  if (idx <= 0) return null;
  const provider = spec.slice(0, idx) as ProviderId;
  const model = spec.slice(idx + 1);
  if (!(provider in PROVIDERS) || !model) return null;
  return { provider, model };
}

/** Look up capability flags for a tier, falling back to conservative defaults. */
export function tierCapabilities(provider: ProviderId, model: string): ModelTier {
  const known = [...DEFAULT_CHAIN, ...PRIVACY_CHAIN].find(
    (t) => t.provider === provider && t.model === model,
  );
  if (known) return known;
  return {
    provider,
    model,
    label: model,
    supportsImages: provider !== "groq",
    supportsPdfNative: provider === "gemini",
    contextTokens: 128000,
  };
}

/**
 * Build the ordered chain of tiers to try for this request.
 *
 * Order of precedence:
 *   1. An explicit model chosen in the picker.
 *   2. Privacy chain (user toggle OR agent is always-private).
 *   3. Default chain.
 */
export function buildChain(body: ChatRequestBody): {
  chain: { provider: ProviderId; model: string }[];
  privacyEnforced: boolean;
  privacyCompromised: boolean;
  warnings: string[];
} {
  const agent = AGENT_BY_ID[body.agentId];
  const warnings: string[] = [];

  const agentForcesPrivacy =
    agent?.forcePrivacy === true || ALWAYS_PRIVATE_AGENTS.includes(body.agentId);
  const privacyEnforced = body.privacyMode || agentForcesPrivacy;

  // An explicit model choice always wins - the user asked for that model.
  if (body.forcedModel) {
    const forced = parseForcedModel(body.forcedModel);
    if (forced) {
      const trains = PROVIDERS[forced.provider].trainsOnYourData;
      let privacyCompromised = false;
      if (privacyEnforced && trains) {
        privacyCompromised = true;
        warnings.push(
          `Privacy is on, but you explicitly selected ${PROVIDERS[forced.provider].label}, ` +
            `which may use your data for training.`,
        );
      }
      // Even with a forced model, keep a privacy-safe tier behind it as a
      // fallback when privacy matters, so a failure does not dead-end.
      const chain = [{ provider: forced.provider, model: forced.model }];
      if (privacyEnforced) {
        for (const t of PRIVACY_CHAIN) {
          if (!(t.provider === forced.provider && t.model === forced.model)) {
            chain.push({ provider: t.provider, model: t.model });
          }
        }
      }
      return { chain, privacyEnforced, privacyCompromised, warnings };
    }
    warnings.push(`Unrecognised model "${body.forcedModel}" - using the default chain.`);
  }

  if (privacyEnforced) {
    const chain: { provider: ProviderId; model: string }[] = PRIVACY_CHAIN.map(
      (t) => ({ provider: t.provider, model: t.model }),
    );

    const allowSoft = body.allowSoftFallback ?? PRIVACY_ALLOW_SOFT_FALLBACK;
    let privacyCompromised = false;

    if (allowSoft) {
      // Append training providers AFTER the safe ones. They are only reached
      // if every privacy-safe tier failed.
      for (const t of DEFAULT_CHAIN) {
        if (PROVIDERS[t.provider].trainsOnYourData) {
          chain.push({ provider: t.provider, model: t.model });
        }
      }
      privacyCompromised = true; // possible, not certain - resolved after routing
    }

    if (agentForcesPrivacy && !body.privacyMode) {
      warnings.push(
        `${agent?.name ?? "This agent"} always uses private routing because it handles sensitive content.`,
      );
    }

    return { chain, privacyEnforced, privacyCompromised, warnings };
  }

  return {
    chain: DEFAULT_CHAIN.map((t) => ({ provider: t.provider, model: t.model })),
    privacyEnforced: false,
    privacyCompromised: false,
    warnings,
  };
}

/**
 * Send a request through the chain and report the outcome.
 */
export async function handleChat(
  body: ChatRequestBody,
  signal?: AbortSignal,
): Promise<ChatResponseBody> {
  const agent = AGENT_BY_ID[body.agentId];
  if (!agent) {
    return {
      ok: false,
      text: "",
      attempts: [],
      error: `Unknown agent "${body.agentId}".`,
      privacyCompromised: false,
      warnings: [],
    };
  }

  const { chain, privacyEnforced, warnings } = buildChain(body);

  const messages: ChatMessage[] = body.messages.map((m) => ({
    role: m.role,
    parts: m.parts,
  }));

  const result = await routeChat({
    chain,
    systemPrompt: agent.systemPrompt,
    messages,
    signal,
    timeoutMs: TIER_TIMEOUT_MS,
  });

  const finalWarnings = [...warnings];
  let privacyCompromised = false;

  if (result.servedBy && privacyEnforced) {
    const trains = PROVIDERS[result.servedBy.provider].trainsOnYourData;
    if (trains) {
      privacyCompromised = true;
      finalWarnings.push(
        `PRIVACY WARNING: private content was sent to ${PROVIDERS[result.servedBy.provider].label}, ` +
          `which may use your data for training. This happened because every private ` +
          `provider (Gemini) failed. Consider re-sending later, or turn on the hard block.`,
      );
    }
  }

  // Surface which tiers were skipped for privacy so the user understands.
  if (privacyEnforced) {
    const skipped = DEFAULT_CHAIN.filter(
      (t) => PROVIDERS[t.provider].trainsOnYourData,
    ).map((t) => PROVIDERS[t.provider].label);
    if (skipped.length) {
      finalWarnings.push(
        `Private routing was used. ${[...new Set(skipped)].join(", ")} ${
          skipped.length > 1 ? "were" : "was"
        } deprioritised because of data-training terms.`,
      );
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      text: "",
      attempts: result.attempts,
      error: result.error,
      privacyCompromised,
      warnings: finalWarnings,
    };
  }

  return {
    ok: true,
    text: result.text,
    servedBy: result.servedBy,
    attempts: result.attempts,
    privacyCompromised,
    warnings: finalWarnings,
  };
}
