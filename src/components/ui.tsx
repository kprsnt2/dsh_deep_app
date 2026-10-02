"use client";

import { AGENTS, CATEGORY_LABELS, type Agent, type AgentCategory } from "@/config/agents";
import type { ProviderId } from "@/config/models";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  note: string;
  trainsOnYourData: boolean;
  configured: boolean;
}

export interface ChainTier {
  provider: ProviderId;
  model: string;
  label: string;
  supportsImages?: boolean;
  supportsPdfNative?: boolean;
}

export interface AppConfig {
  providers: ProviderInfo[];
  defaultChain: ChainTier[];
  privacyChain: ChainTier[];
  passcodeRequired: boolean;
}

/** Small coloured avatar for an agent. */
export function AgentAvatar({
  agent,
  size = "md",
}: {
  agent: Agent;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-7 w-7 text-sm" : size === "lg" ? "h-12 w-12 text-2xl" : "h-9 w-9 text-lg";
  return (
    <div
      className={`${dim} shrink-0 rounded-full bg-gradient-to-br ${agent.accent} flex items-center justify-center shadow-sm`}
      aria-hidden
    >
      <span>{agent.emoji}</span>
    </div>
  );
}

/** Provider chip showing whether it trains on your data. */
export function ProviderBadge({ p }: { p: ProviderInfo }) {
  const color = !p.configured
    ? "bg-ink-800 text-gray-500 border-ink-700"
    : p.trainsOnYourData
      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${color}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          p.configured ? "bg-current" : "bg-gray-600"
        }`}
      />
      {p.label}
      {p.configured ? (p.trainsOnYourData ? " · trains on data" : " · private") : " · no key"}
    </span>
  );
}

export function agentGroups(): { category: AgentCategory; agents: Agent[] }[] {
  const order: AgentCategory[] = [
    "family",
    "learning",
    "health",
    "mind",
    "work",
    "life",
    "creative",
    "utility",
  ];
  return order
    .map((category) => ({
      category,
      agents: AGENTS.filter((a) => a.category === category),
    }))
    .filter((g) => g.agents.length > 0);
}

export { CATEGORY_LABELS };
