"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import Composer, { type PendingAttachment } from "@/components/Composer";
import Message, { type DisplayMessage } from "@/components/Message";
import Settings from "@/components/Settings";
import { AgentAvatar, type AppConfig } from "@/components/ui";
import { AGENT_BY_ID, AGENTS } from "@/config/agents";
import {
  addMessage,
  attachmentToPart,
  createChat,
  deleteChat,
  getAttachments,
  getMessages,
  listChats,
  loadSetting,
  putAttachment,
  saveSetting,
  uid,
  updateChat,
  type StoredChat,
} from "@/lib/storage";
import type { ContentPart } from "@/lib/providers";

const PASSCODE_KEY = "app-passcode";

export default function Home() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [passcode, setPasscode] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeChat, setActiveChat] = useState<StoredChat | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [forcedModel, setForcedModel] = useState<string>("");
  const [privacyMode, setPrivacyMode] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* ------------------------------ bootstrap ------------------------------ */

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        const json = (await res.json()) as AppConfig;
        setConfig(json);

        const saved = await loadSetting<string>(PASSCODE_KEY);
        if (json.passcodeRequired && !saved) {
          setAuthed(false);
        } else {
          if (saved) setPasscode(saved);
          setAuthed(true);
        }
        setChats(await listChats());
      } catch {
        setAuthError("Could not reach the server. Is it running?");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ------------------------------- chat ops ------------------------------ */

  const openChat = useCallback(async (chat: StoredChat) => {
    setActiveChat(chat);
    setPrivacyMode(chat.privacyMode);
    setForcedModel(chat.forcedModel ?? "");
    const stored = await getMessages(chat.id);
    const display: DisplayMessage[] = [];
    for (const m of stored) {
      const atts: PendingAttachment[] = [];
      if (m.attachmentIds.length) {
        const found = await getAttachments(m.attachmentIds);
        for (const a of found) {
          atts.push({
            ...a,
            previewUrl: a.mimeType.startsWith("image/")
              ? URL.createObjectURL(a.blob)
              : undefined,
          });
        }
      }
      display.push({
        id: m.id,
        role: m.role,
        text: m.text,
        attachments: atts,
        servedBy: m.servedBy as DisplayMessage["servedBy"],
        attempts: m.attempts as DisplayMessage["attempts"],
        warnings: m.warnings,
        privacyCompromised: m.privacyCompromised,
        error: m.error,
        createdAt: m.createdAt,
      });
    }
    setMessages(display);
    setSidebarOpen(false);
  }, []);

  const newChat = useCallback(
    async (agentId: string) => {
      const chat = await createChat(agentId, privacyMode, forcedModel || null);
      setChats(await listChats());
      setActiveChat(chat);
      setMessages([]);
      setAttachments([]);
      setInput("");
      setSidebarOpen(false);
    },
    [privacyMode, forcedModel],
  );

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id);
      setChats(await listChats());
      if (activeChat?.id === id) {
        setActiveChat(null);
        setMessages([]);
      }
    },
    [activeChat],
  );

  /* -------------------------------- sending ------------------------------ */

  const send = useCallback(async () => {
    if (busy) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    let chat = activeChat;
    if (!chat) {
      const agentId = "general";
      chat = await createChat(agentId, privacyMode, forcedModel || null);
      setChats(await listChats());
      setActiveChat(chat);
    }

    const agent = AGENT_BY_ID[chat.agentId];

    // Persist attachments first so they survive a refresh.
    const attachmentIds: string[] = [];
    for (const a of attachments) {
      await putAttachment({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        blob: a.blob,
        extractedText: a.extractedText,
        sendable: a.sendable,
        note: a.note,
      });
      attachmentIds.push(a.id);
    }

    const userMsg: DisplayMessage = {
      id: uid(),
      role: "user",
      text,
      attachments: [...attachments],
      createdAt: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setAttachments([]);

    await addMessage({
      id: userMsg.id,
      chatId: chat.id,
      role: "user",
      text,
      attachmentIds,
      createdAt: userMsg.createdAt,
    });

    // Name the chat from the first message.
    if (chat.title === "New chat" && text) {
      const title = text.length > 48 ? `${text.slice(0, 48)}…` : text;
      await updateChat(chat.id, { title });
      setChats(await listChats());
      setActiveChat({ ...chat, title });
    }

    // Build the wire payload from stored history + this turn.
    const history = await getMessages(chat.id);
    const wire: { role: "user" | "assistant"; parts: ContentPart[] }[] = [];

    for (const m of history) {
      const parts: ContentPart[] = [];
      if (m.text) parts.push({ type: "text", text: m.text });
      if (m.attachmentIds.length) {
        const found = await getAttachments(m.attachmentIds);
        for (const a of found) {
          const p = await attachmentToPart(a);
          if (p) parts.push(p);
        }
      }
      if (parts.length) wire.push({ role: m.role, parts });
    }

    // Cap history so we do not blow the context window.
    const trimmed = wire.slice(-16);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    const placeholderId = uid();
    setMessages((m) => [
      ...m,
      { id: placeholderId, role: "assistant", text: "", createdAt: Date.now(), streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(passcode ? { "x-app-passcode": passcode } : {}),
        },
        body: JSON.stringify({
          agentId: chat.agentId,
          forcedModel: forcedModel || null,
          privacyMode,
          messages: trimmed,
        }),
        signal: controller.signal,
      });

      const json = await res.json();

      if (res.status === 401) {
        setAuthed(false);
        setAuthError("Passcode rejected. Please sign in again.");
        setMessages((m) => m.filter((x) => x.id !== placeholderId));
        return;
      }

      const reply: DisplayMessage = {
        id: placeholderId,
        role: "assistant",
        text: json.text ?? "",
        servedBy: json.servedBy,
        attempts: json.attempts,
        warnings: json.warnings,
        privacyCompromised: json.privacyCompromised,
        error: json.ok ? undefined : (json.error ?? "Request failed."),
        createdAt: Date.now(),
      };

      setMessages((m) => m.map((x) => (x.id === placeholderId ? reply : x)));

      await addMessage({
        id: placeholderId,
        chatId: chat.id,
        role: "assistant",
        text: reply.text,
        attachmentIds: [],
        createdAt: reply.createdAt,
        servedBy: reply.servedBy,
        attempts: reply.attempts,
        warnings: reply.warnings,
        privacyCompromised: reply.privacyCompromised,
        error: reply.error,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setMessages((m) =>
        m.map((x) =>
          x.id === placeholderId
            ? {
                ...x,
                streaming: false,
                error: aborted ? "Stopped." : "Network error. Check your connection.",
              }
            : x,
        ),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, input, attachments, activeChat, privacyMode, forcedModel, passcode]);

  /* ------------------------------ passcode ------------------------------- */

  const tryAuth = async () => {
    setAuthError(null);
    try {
      const res = await fetch("/api/config");
      const json = (await res.json()) as AppConfig;
      if (!json.passcodeRequired) {
        setAuthed(true);
        return;
      }
      // Validate against the chat endpoint with a deliberately empty request:
      // a 401 means the passcode is wrong, anything else means it passed the gate.
      const probe = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-passcode": passcode,
        },
        body: JSON.stringify({ agentId: "", messages: [] }),
      });
      if (probe.status === 401) {
        setAuthError("Incorrect passcode.");
        return;
      }
      await saveSetting(PASSCODE_KEY, passcode);
      setAuthed(true);
      setChats(await listChats());
    } catch {
      setAuthError("Could not reach the server.");
    }
  };

  /* -------------------------------- render ------------------------------- */

  if (!ready) {
    return (
      <main className="flex h-screen items-center justify-center">
        <p className="text-gray-500 animate-pulse-soft">Loading…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-ink-700 bg-ink-900 p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center">
              ✦
            </div>
            <h1 className="font-semibold">All-in-One Chat</h1>
          </div>
          <label className="mb-1 block text-[12px] text-gray-400">
            Enter your passcode
          </label>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void tryAuth()}
            className="w-full rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 text-sm outline-none focus:border-ink-600"
            placeholder="••••••••"
            autoFocus
          />
          {authError && (
            <p className="mt-2 text-[12px] text-red-300">{authError}</p>
          )}
          <button
            onClick={() => void tryAuth()}
            className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 transition"
          >
            Unlock
          </button>
          <p className="mt-3 text-[11px] text-gray-600">
            Set <code className="md-code">APP_PASSCODE</code> in your{" "}
            <code className="md-code">.env</code> file. Leave it blank to disable
            the lock.
          </p>
        </div>
      </main>
    );
  }

  const agent = activeChat ? AGENT_BY_ID[activeChat.agentId] : null;
  const isWorksheet = activeChat?.agentId === "worksheet";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar - desktop */}
      <div className="hidden lg:block w-[300px] shrink-0">
        <Sidebar
          config={config}
          chats={chats}
          activeChatId={activeChat?.id ?? null}
          onSelectChat={(id) => {
            const c = chats.find((x) => x.id === id);
            if (c) void openChat(c);
          }}
          onNewChat={(agentId) => void newChat(agentId)}
          onDeleteChat={(id) => void removeChat(id)}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      {/* sidebar - mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[290px]">
            <Sidebar
              config={config}
              chats={chats}
              activeChatId={activeChat?.id ?? null}
              onSelectChat={(id) => {
                const c = chats.find((x) => x.id === id);
                if (c) void openChat(c);
              }}
              onNewChat={(agentId) => void newChat(agentId)}
              onDeleteChat={(id) => void removeChat(id)}
              onOpenSettings={() => {
                setShowSettings(true);
                setSidebarOpen(false);
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-3 py-2.5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden h-9 w-9 rounded-xl hover:bg-ink-800 text-gray-400"
            aria-label="Open menu"
          >
            ☰
          </button>

          {agent ? (
            <div className="flex min-w-0 items-center gap-2">
              <AgentAvatar agent={agent} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{agent.name}</p>
                <p className="truncate text-[11px] text-gray-500">
                  {agent.tagline}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-gray-500">
              Pick an agent from the sidebar to begin
            </p>
          )}

          <div className="flex-1" />

          {/* model picker */}
          <div className="relative">
            <button
              onClick={() => setModelMenuOpen((o) => !o)}
              className="rounded-xl border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11px] text-gray-300 hover:border-ink-600 transition max-w-[190px] truncate"
            >
              {forcedModel
                ? (config?.defaultChain.find(
                    (t) => `${t.provider}:${t.model}` === forcedModel,
                  )?.label ?? forcedModel)
                : "Auto (fallback chain)"}
            </button>

            {modelMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setModelMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-[300px] rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl">
                  <MenuItem
                    active={forcedModel === ""}
                    onClick={() => {
                      setForcedModel("");
                      setModelMenuOpen(false);
                    }}
                    title="Auto (fallback chain)"
                    sub="Try each model in order until one works"
                  />
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-600">
                    Or force one model
                  </p>
                  {config?.defaultChain.map((t) => {
                    const id = `${t.provider}:${t.model}`;
                    const p = config.providers.find((x) => x.id === t.provider);
                    return (
                      <MenuItem
                        key={id}
                        active={forcedModel === id}
                        onClick={() => {
                          setForcedModel(id);
                          setModelMenuOpen(false);
                        }}
                        title={t.label}
                        sub={`${p?.label}${p?.trainsOnYourData ? " · trains on data" : " · private"}${
                          p?.configured ? "" : " · no key"
                        }`}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* privacy toggle */}
          <button
            onClick={() => setPrivacyMode((p) => !p)}
            title="Private mode routes to Gemini only (no training on your data)"
            className={`rounded-xl border px-2.5 py-1.5 text-[11px] transition ${
              privacyMode
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-ink-700 bg-ink-850 text-gray-400 hover:border-ink-600"
            }`}
          >
            {privacyMode ? "🔒 Private" : "🔓 Standard"}
          </button>
        </header>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-3 py-5 space-y-5">
            {messages.length === 0 && (
              <EmptyState
                agentId={activeChat?.agentId ?? null}
                onPick={(agentId) => void newChat(agentId)}
                onStarter={(s) => setInput(s)}
              />
            )}
            {messages.map((m) => (
              <Message
                key={m.id}
                msg={m}
                agentId={activeChat?.agentId ?? "general"}
                chatTitle={activeChat?.title ?? "chat"}
                isWorksheet={isWorksheet}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-ink-800 bg-ink-900 px-3 py-3">
          <div className="mx-auto max-w-3xl">
            <Composer
              value={input}
              onChange={setInput}
              onSend={() => void send()}
              attachments={attachments}
              setAttachments={setAttachments}
              busy={busy}
              onStop={() => abortRef.current?.abort()}
              placeholder={
                agent ? `Message ${agent.name}…` : "Pick an agent, then type…"
              }
              hint={agent?.attachmentHint}
            />
          </div>
        </div>
      </div>

      {showSettings && (
        <Settings
          config={config}
          passcode={passcode}
          onClose={() => setShowSettings(false)}
          onCleared={() => {
            setChats([]);
            setActiveChat(null);
            setMessages([]);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ sub-components --------------------------- */

function MenuItem({
  title,
  sub,
  active,
  onClick,
}: {
  title: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-2 py-1.5 text-left transition ${
        active ? "bg-ink-800" : "hover:bg-ink-850"
      }`}
    >
      <p className="text-[12px] text-gray-200 flex items-center gap-1.5">
        {active && <span className="text-sky-400">✓</span>}
        {title}
      </p>
      <p className="text-[10px] text-gray-500 pl-4">{sub}</p>
    </button>
  );
}

function EmptyState({
  agentId,
  onPick,
  onStarter,
}: {
  agentId: string | null;
  onPick: (agentId: string) => void;
  onStarter: (s: string) => void;
}) {
  const agent = agentId ? AGENT_BY_ID[agentId] : null;

  if (agent) {
    return (
      <div className="py-8 text-center">
        <div className="mb-3 flex justify-center">
          <AgentAvatar agent={agent} size="lg" />
        </div>
        <h2 className="text-lg font-semibold">{agent.name}</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-gray-500">
          {agent.tagline}
        </p>
        {agent.attachmentHint && (
          <p className="mx-auto mt-2 max-w-md text-[12px] text-sky-400/80">
            💡 {agent.attachmentHint}
          </p>
        )}
        <div className="mx-auto mt-5 grid max-w-lg gap-2">
          {agent.starters.map((s) => (
            <button
              key={s}
              onClick={() => onStarter(s)}
              className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left text-[13px] text-gray-300 hover:border-ink-600 hover:bg-ink-800 transition"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 text-center">
      <h2 className="text-lg font-semibold">Choose an agent</h2>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-gray-500">
        Each agent is tuned for a different job. Pick one and start chatting.
      </p>
      <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
        {AGENTS.slice(0, 8).map((a) => (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            className="flex items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left hover:border-ink-600 hover:bg-ink-800 transition"
          >
            <AgentAvatar agent={a} size="sm" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-gray-200">{a.name}</p>
              <p className="text-[11px] text-gray-500 leading-snug">
                {a.tagline}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
