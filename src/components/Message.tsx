"use client";

import { useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { downloadPdf, suggestFilename } from "@/lib/pdf";
import { AGENT_BY_ID } from "@/config/agents";
import { AgentAvatar } from "./ui";
import type { PendingAttachment } from "./Composer";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: PendingAttachment[];
  servedBy?: { provider: string; model: string };
  attempts?: { provider: string; model: string; ok: boolean; ms: number; error?: string }[];
  warnings?: string[];
  privacyCompromised?: boolean;
  error?: string;
  createdAt: number;
  streaming?: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  nvidia: "NVIDIA",
  groq: "Groq",
};

export default function Message({
  msg,
  agentId,
  chatTitle,
  isWorksheet,
}: {
  msg: DisplayMessage;
  agentId: string;
  chatTitle: string;
  isWorksheet: boolean;
}) {
  const agent = AGENT_BY_ID[agentId];
  const [showTrace, setShowTrace] = useState(false);
  const [copied, setCopied] = useState(false);

  const html = useMemo(
    () => (msg.role === "assistant" ? renderMarkdown(msg.text) : ""),
    [msg.role, msg.text],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  /* ------------------------------ user turn ------------------------------ */
  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] sm:max-w-[75%]">
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 justify-end">
              {msg.attachments.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl overflow-hidden border border-ink-700 bg-ink-850"
                >
                  {a.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      className="h-24 w-24 object-cover"
                    />
                  ) : (
                    <div className="px-3 py-2 text-[12px] text-gray-300">
                      📄 {a.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {msg.text && (
            <div className="rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-[15px] whitespace-pre-wrap break-words">
              {msg.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------------------------- assistant turn --------------------------- */
  return (
    <div className="flex gap-3 animate-fade-up">
      {agent && <AgentAvatar agent={agent} />}

      <div className="min-w-0 flex-1">
        {/* header */}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-200">
            {agent?.name ?? agentId}
          </span>
          {msg.servedBy && (
            <span className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] text-gray-400">
              {PROVIDER_LABEL[msg.servedBy.provider] ?? msg.servedBy.provider} ·{" "}
              {msg.servedBy.model}
            </span>
          )}
          {msg.privacyCompromised && (
            <span className="rounded-md border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300 font-medium">
              ⚠ PRIVATE DATA SENT TO A TRAINING PROVIDER
            </span>
          )}
        </div>

        {/* warnings */}
        {msg.warnings?.map((w, i) => (
          <div
            key={i}
            className={`mb-2 rounded-lg border px-3 py-2 text-[12px] ${
              w.startsWith("PRIVACY WARNING")
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-amber-500/25 bg-amber-500/10 text-amber-200"
            }`}
          >
            {w}
          </div>
        ))}

        {/* body */}
        {msg.error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
            {msg.error}
          </div>
        ) : (
          <div
            className="text-[15px] text-gray-100 break-words"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {msg.streaming && (
          <span className="inline-block h-4 w-2 bg-sky-400 animate-pulse-soft align-middle" />
        )}

        {/* actions */}
        {!msg.streaming && (msg.text || msg.error) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 no-print">
            <Action onClick={copy}>{copied ? "Copied" : "Copy"}</Action>
            {!msg.error && (
              <Action
                onClick={() =>
                  downloadPdf(msg.text, suggestFilename(chatTitle, agentId), {
                    title: chatTitle,
                    // Worksheets get the name/date/score header block.
                    worksheetHeader: isWorksheet,
                  })
                }
              >
                {isWorksheet ? "⬇ Print / PDF" : "⬇ PDF"}
              </Action>
            )}
            {msg.attempts && msg.attempts.length > 0 && (
              <Action onClick={() => setShowTrace((s) => !s)}>
                {showTrace ? "Hide" : "Why?"} ({msg.attempts.length} model
                {msg.attempts.length > 1 ? "s" : ""} tried)
              </Action>
            )}
          </div>
        )}

        {/* routing trace */}
        {showTrace && msg.attempts && (
          <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">
              Model fallback trace
            </p>
            <div className="space-y-1.5">
              {msg.attempts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      a.ok ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="text-gray-300">
                      {PROVIDER_LABEL[a.provider] ?? a.provider} · {a.model}
                    </span>
                    <span className="ml-2 text-gray-600">{a.ms}ms</span>
                    {a.error && (
                      <p className="text-red-300/80 break-words">{a.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Action({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200 hover:border-ink-600 transition"
    >
      {children}
    </button>
  );
}
