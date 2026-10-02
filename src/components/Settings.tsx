"use client";

import { useEffect, useState } from "react";
import { estimateUsage, clearAll } from "@/lib/storage";
import { ProviderBadge, type AppConfig } from "./ui";

interface TestTier {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  configured: boolean;
  providerReachable: boolean;
  modelListed: boolean | null;
  suggestion: string | null;
}

export default function Settings({
  config,
  passcode,
  onClose,
  onCleared,
}: {
  config: AppConfig | null;
  passcode: string;
  onClose: () => void;
  onCleared: () => void;
}) {
  const [usage, setUsage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [tiers, setTiers] = useState<TestTier[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    void estimateUsage().then(setUsage);
  }, []);

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const res = await fetch("/api/test-models", {
        headers: passcode ? { "x-app-passcode": passcode } : {},
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTestError(json.error ?? `Request failed (${res.status})`);
      } else {
        setTiers(json.tiers as TestTier[]);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Network error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="font-semibold">Settings &amp; models</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-ink-800 text-gray-400"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="space-y-6 p-5">
          {/* ---------- providers ---------- */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-gray-300">
              Providers
            </h3>
            <p className="mb-3 text-[12px] text-gray-500">
              API keys live only on the server, in your <code className="md-code">.env</code>{" "}
              file. They are never sent to the browser.
            </p>
            <div className="flex flex-wrap gap-2">
              {config?.providers.map((p) => (
                <ProviderBadge key={p.id} p={p} />
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {config?.providers.map((p) => (
                <p key={p.id} className="text-[11px] text-gray-500">
                  <span className="text-gray-400">{p.label}:</span> {p.note}
                </p>
              ))}
            </div>
          </section>

          {/* ---------- fallback order ---------- */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-gray-300">
              Fallback order
            </h3>
            <p className="mb-3 text-[12px] text-gray-500">
              Tried top to bottom. The first one that answers wins. Edit{" "}
              <code className="md-code">src/config/models.ts</code> to change this.
            </p>
            <ol className="space-y-1.5">
              {config?.defaultChain.map((t, i) => {
                const p = config.providers.find((x) => x.id === t.provider);
                return (
                  <li
                    key={`${t.provider}-${t.model}`}
                    className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2"
                  >
                    <span className="h-6 w-6 shrink-0 rounded-md bg-ink-800 text-center text-[12px] leading-6 text-gray-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-gray-200">{t.label}</p>
                      <p className="text-[11px] text-gray-500 font-mono truncate">
                        {t.provider}:{t.model}
                      </p>
                    </div>
                    {p?.trainsOnYourData ? (
                      <span className="shrink-0 text-[10px] text-amber-400">
                        trains on data
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-emerald-400">
                        private
                      </span>
                    )}
                    {!p?.configured && (
                      <span className="shrink-0 text-[10px] text-gray-600">
                        no key
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          {/* ---------- model test ---------- */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-gray-300">
              Verify model IDs
            </h3>
            <p className="mb-3 text-[12px] text-gray-500">
              Provider model names change often. If an ID is wrong the router
              silently skips that tier. Run this to check each ID against what
              the provider actually offers.
            </p>
            <button
              onClick={runTest}
              disabled={testing}
              className="rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-medium hover:bg-sky-500 disabled:bg-ink-700 disabled:text-gray-500 transition"
            >
              {testing ? "Checking…" : "Test models"}
            </button>

            {testError && (
              <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
                {testError}
              </p>
            )}

            {tiers && (
              <div className="mt-3 space-y-1.5">
                {tiers.map((t) => {
                  const ok = t.configured && t.providerReachable && t.modelListed !== false;
                  return (
                    <div
                      key={`${t.provider}-${t.model}`}
                      className={`rounded-lg border px-3 py-2 ${
                        ok
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-amber-500/30 bg-amber-500/5"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            ok ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                        />
                        <span className="text-[12px] text-gray-200">
                          {t.providerLabel} · {t.model}
                        </span>
                      </div>
                      <p className="mt-0.5 pl-4 text-[11px] text-gray-500">
                        {!t.configured
                          ? "No API key set for this provider."
                          : !t.providerReachable
                            ? "Provider unreachable or key rejected."
                            : t.modelListed === true
                              ? "Model ID confirmed available."
                              : t.modelListed === false
                                ? `Model not listed by the provider.${t.suggestion ? ` Closest match: ${t.suggestion}` : ""}`
                                : "Provider does not expose a model list; cannot verify."}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---------- storage ---------- */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-gray-300">
              Storage
            </h3>
            <p className="text-[12px] text-gray-500">
              All chats and attachments are stored in your browser&apos;s IndexedDB.
              Nothing is uploaded to a server we control.
            </p>
            {usage && (
              <p className="mt-2 text-[12px] text-gray-400">
                Using <span className="text-gray-200">{usage.usedMB.toFixed(1)} MB</span>
                {usage.quotaMB > 0 && (
                  <> of roughly {usage.quotaMB.toFixed(0)} MB available</>
                )}
              </p>
            )}
            <button
              onClick={async () => {
                if (
                  !confirm(
                    "Delete ALL chats, messages and attachments from this browser? This cannot be undone.",
                  )
                )
                  return;
                await clearAll();
                onCleared();
              }}
              className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 hover:bg-red-500/20 transition"
            >
              Delete all local data
            </button>
          </section>

          {/* ---------- privacy explainer ---------- */}
          <section className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <h3 className="mb-2 text-[13px] font-semibold text-gray-300">
              How Privacy Mode works
            </h3>
            <ul className="space-y-1.5 text-[12px] text-gray-400 list-disc pl-4">
              <li>
                Private chats go to <span className="text-emerald-400">Gemini only</span> —
                your paid key, which does not train on your data.
              </li>
              <li>
                <span className="text-gray-300">Doctor</span> and{" "}
                <span className="text-gray-300">Psycho</span> always use private
                routing, even if the toggle is off.
              </li>
              <li>
                If Gemini fails, the app falls back to a training provider and shows
                a red warning on that message. To forbid this, set{" "}
                <code className="md-code">PRIVACY_ALLOW_SOFT_FALLBACK = false</code> in{" "}
                <code className="md-code">src/config/models.ts</code>.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
