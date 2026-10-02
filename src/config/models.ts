/**
 * ============================================================================
 *  EDIT THIS FILE TO CHANGE MODELS, AGENTS AND ROUTING.
 *  Nothing else in the app hardcodes a model ID.
 * ============================================================================
 *
 *  HOW THE FALLBACK CHAIN WORKS
 *  ----------------------------
 *  You pick an ordered list of "tiers". The app tries tier 1; if it fails
 *  (bad key, rate limit, outage, timeout, safety refusal) it moves to tier 2,
 *  and so on. The first tier that answers wins, and the UI tells you which
 *  provider actually served the reply.
 *
 *  DEFAULT ORDER (as requested):
 *    1. OpenAI   -> gpt-5.4-mini  (then gpt-5.4-nano)
 *    2. Gemini   -> gemini-flash-latest
 *    3. NVIDIA   -> nemotron / llama
 *    4. Groq     -> llama-3.3-70b
 *
 *  !! VERIFY YOUR MODEL IDS !!
 *  Provider model names change often. If a model ID is wrong the provider
 *  returns a 404 and the router silently falls through to the next tier --
 *  so the app keeps working, but you may not be using the model you think.
 *  Open Settings -> "Test models" in the app to check each one live, then
 *  correct the IDs below.
 */

export type ProviderId = "openai" | "gemini" | "nvidia" | "groq";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** Where the API key comes from. Set the matching env var on the server. */
  apiKeyEnv: string;
  /** Human note shown in Settings. */
  note: string;
  /**
   * TRAINING / PRIVACY FLAG.
   * true  = this provider may train on your data (free tiers generally do).
   *         Privacy Mode will avoid it unless it is the only option left.
   * false = paid/enterprise terms, data not used for training.
   */
  trainsOnYourData: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    note: "Free tier: your chats may be used for training. Privacy Mode avoids this provider.",
    trainsOnYourData: true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    note: "Your paid key. Data is not used for training. This is the Privacy Mode default.",
    trainsOnYourData: false,
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    apiKeyEnv: "NVIDIA_API_KEY",
    note: "Free developer tier. Used as a later fallback.",
    trainsOnYourData: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    apiKeyEnv: "GROQ_API_KEY",
    note: "Free tier, very fast. Last-resort fallback.",
    trainsOnYourData: true,
  },
};

export interface ModelTier {
  provider: ProviderId;
  /** Exact model ID sent to the provider API. EDIT THIS if the provider renames it. */
  model: string;
  /** Shown in the model picker. */
  label: string;
  /** Capability flags used to route attachments correctly. */
  supportsImages: boolean;
  supportsPdfNative: boolean;
  /** Rough context window, used to warn before sending very large inputs. */
  contextTokens: number;
}

/**
 * The default chain, in priority order. Reorder these lines to change
 * priority. Delete a line to remove a provider entirely.
 */
export const DEFAULT_CHAIN: ModelTier[] = [
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    supportsImages: true,
    supportsPdfNative: false,
    contextTokens: 128000,
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    supportsImages: true,
    supportsPdfNative: false,
    contextTokens: 128000,
  },
  {
    provider: "gemini",
    model: "gemini-flash-latest",
    label: "Gemini Flash (latest)",
    supportsImages: true,
    supportsPdfNative: true,
    contextTokens: 1000000,
  },
  {
    provider: "nvidia",
    model: "meta/llama-3.2-90b-vision-instruct",
    label: "NVIDIA Llama 3.2 90B Vision",
    supportsImages: true,
    supportsPdfNative: false,
    contextTokens: 128000,
  },
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Groq Llama 3.3 70B",
    supportsImages: false,
    supportsPdfNative: false,
    contextTokens: 128000,
  },
];

/**
 * PRIVACY MODE CHAIN.
 * Only providers with trainsOnYourData === false, in priority order.
 * Gemini first because you have a paid key.
 */
export const PRIVACY_CHAIN: ModelTier[] = [
  {
    provider: "gemini",
    model: "gemini-flash-latest",
    label: "Gemini Flash (latest)",
    supportsImages: true,
    supportsPdfNative: true,
    contextTokens: 1000000,
  },
];

/**
 * When Privacy Mode is ON and Gemini is unreachable:
 *   false = HARD BLOCK. The request fails with a clear error. Nothing leaks.
 *   true  = SOFT FALLBACK to a training provider, with a loud warning shown
 *           in the UI and a permanent banner on the message.
 *
 * You chose soft fallback. Switch this to `false` any time for a hard block.
 * WARNING: with a FREE OpenAI key, soft fallback can send private medical
 * photos to OpenAI during a Gemini outage.
 */
export const PRIVACY_ALLOW_SOFT_FALLBACK = true;

/**
 * How long to wait for one provider before giving up and trying the next.
 * Keep this comfortably below your hosting platform's function timeout.
 */
export const TIER_TIMEOUT_MS = 45000;

/** Max images accepted in a single message. */
export const MAX_IMAGES_PER_MESSAGE = 20;

/** Max total attachment payload per message, in megabytes. */
export const MAX_ATTACHMENT_MB = 24;

/**
 * Agents that must NEVER be routed to a training provider, regardless of the
 * Privacy Mode toggle. Medical and psychological content is sensitive by
 * default. Set to [] to disable this safety rail entirely.
 */
export const ALWAYS_PRIVATE_AGENTS = ["doctor", "psycho"];
