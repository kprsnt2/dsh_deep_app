"use client";

import { useState } from "react";
import { AGENT_BY_ID } from "@/config/agents";
import type { StoredChat } from "@/lib/storage";
import { AgentAvatar, agentGroups, CATEGORY_LABELS, type AppConfig } from "./ui";

interface Props {
  config: AppConfig | null;
  chats: StoredChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: (agentId: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenSettings: () => void;
  onClose?: () => void;
}

export default function Sidebar({
  config,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onOpenSettings,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"agents" | "chats">("agents");

  return (
    <aside className="flex h-full w-full flex-col bg-ink-900 border-r border-ink-800">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-ink-800">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-sm">
          ✦
        </div>
        <span className="font-semibold text-sm flex-1">All-in-One Chat</span>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden h-8 w-8 rounded-lg hover:bg-ink-800 text-gray-400"
            aria-label="Close sidebar"
          >
            ×
          </button>
        )}
      </div>

      {/* tabs */}
      <div className="flex gap-1 p-2">
        <TabBtn active={tab === "agents"} onClick={() => setTab("agents")}>
          Agents
        </TabBtn>
        <TabBtn active={tab === "chats"} onClick={() => setTab("chats")}>
          Chats {chats.length > 0 && `(${chats.length})`}
        </TabBtn>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tab === "agents" ? (
          <div className="space-y-4">
            {agentGroups().map((group) => (
              <div key={group.category}>
                <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">
                  {CATEGORY_LABELS[group.category]}
                </p>
                <div className="space-y-0.5">
                  {group.agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => onNewChat(agent.id)}
                      className="w-full rounded-xl px-2 py-2 text-left hover:bg-ink-800 transition flex items-start gap-2.5 group"
                    >
                      <AgentAvatar agent={agent} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-gray-200">
                            {agent.name}
                          </span>
                          {agent.forcePrivacy && (
                            <span
                              title="This agent always uses private routing"
                              className="text-[9px] rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-1"
                            >
                              private
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">
                          {agent.tagline}
                        </p>
                      </div>
                      <span className="text-gray-600 group-hover:text-sky-400 text-sm opacity-0 group-hover:opacity-100 transition">
                        +
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {chats.length === 0 && (
              <p className="px-2 py-6 text-center text-[12px] text-gray-600">
                No chats yet. Pick an agent to start.
              </p>
            )}
            {chats.map((chat) => {
              const agent = AGENT_BY_ID[chat.agentId];
              const active = chat.id === activeChatId;
              return (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-2 rounded-xl px-2 py-2 cursor-pointer transition ${
                    active ? "bg-ink-800" : "hover:bg-ink-850"
                  }`}
                  onClick={() => onSelectChat(chat.id)}
                >
                  {agent && <AgentAvatar agent={agent} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-200">
                      {chat.title}
                    </p>
                    <p className="text-[10px] text-gray-500 flex items-center gap-1">
                      {agent?.name}
                      {chat.privacyMode && (
                        <span className="text-emerald-400">· 🔒 private</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(chat.id);
                    }}
                    className="h-6 w-6 rounded-md text-gray-600 hover:text-red-400 hover:bg-ink-700 opacity-0 group-hover:opacity-100 transition text-sm"
                    aria-label="Delete chat"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-ink-800 p-2">
        <button
          onClick={onOpenSettings}
          className="w-full rounded-xl px-3 py-2 text-left text-[12px] text-gray-400 hover:bg-ink-800 hover:text-gray-200 transition flex items-center gap-2"
        >
          ⚙️ Settings &amp; models
        </button>
        {config && (
          <div className="px-3 py-1.5 flex flex-wrap gap-1">
            {config.providers
              .filter((p) => p.configured)
              .map((p) => (
                <span
                  key={p.id}
                  className={`h-1.5 w-1.5 rounded-full ${
                    p.trainsOnYourData ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  title={`${p.label}: ${p.trainsOnYourData ? "trains on data" : "private"}`}
                />
              ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
        active ? "bg-ink-800 text-gray-100" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
