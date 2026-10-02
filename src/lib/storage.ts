import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ContentPart } from "./providers";

/**
 * Browser-only storage. Nothing here ever leaves the device.
 * Attachments are stored as Blobs in IndexedDB, which has a much larger
 * quota than localStorage (typically hundreds of MB to several GB).
 */

export interface StoredAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  /** Extracted plain text, for PDFs/CSVs/text files. Empty for images. */
  extractedText?: string;
  /** True when the model can receive this directly. */
  sendable: boolean;
  /** Why it could not be sent, if sendable is false. */
  note?: string;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  attachmentIds: string[];
  createdAt: number;
  /** Which provider/model actually answered. */
  servedBy?: { provider: string; model: string };
  /** Tier attempts, for transparency. */
  attempts?: { provider: string; model: string; ok: boolean; ms: number; error?: string }[];
  warnings?: string[];
  privacyCompromised?: boolean;
  error?: string;
}

export interface StoredChat {
  id: string;
  title: string;
  agentId: string;
  /** "provider:model" or null for the default chain. */
  forcedModel: string | null;
  privacyMode: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ChatDB extends DBSchema {
  chats: { key: string; value: StoredChat; indexes: { "by-updated": number } };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { "by-chat": string; "by-chat-created": [string, number] };
  };
  attachments: { key: string; value: StoredAttachment };
  settings: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    throw new Error("Storage is only available in the browser.");
  }
  if (!dbPromise) {
    dbPromise = openDB<ChatDB>("all-in-one-chat", 1, {
      upgrade(db) {
        const chats = db.createObjectStore("chats", { keyPath: "id" });
        chats.createIndex("by-updated", "updatedAt");

        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("by-chat", "chatId");
        messages.createIndex("by-chat-created", ["chatId", "createdAt"]);

        db.createObjectStore("attachments", { keyPath: "id" });
        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ------------------------------- chats ------------------------------- */

export async function createChat(
  agentId: string,
  privacyMode: boolean,
  forcedModel: string | null = null,
): Promise<StoredChat> {
  const db = await getDB();
  const now = Date.now();
  const chat: StoredChat = {
    id: uid(),
    title: "New chat",
    agentId,
    forcedModel,
    privacyMode,
    createdAt: now,
    updatedAt: now,
  };
  await db.put("chats", chat);
  return chat;
}

export async function listChats(): Promise<StoredChat[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("chats", "by-updated");
  return all.reverse();
}

export async function getChat(id: string): Promise<StoredChat | undefined> {
  return (await getDB()).get("chats", id);
}

export async function updateChat(
  id: string,
  patch: Partial<StoredChat>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get("chats", id);
  if (!existing) return;
  await db.put("chats", { ...existing, ...patch, updatedAt: Date.now() });
}

export async function deleteChat(id: string): Promise<void> {
  const db = await getDB();
  const msgs = await db.getAllFromIndex("messages", "by-chat", id);
  const tx = db.transaction(["chats", "messages", "attachments"], "readwrite");
  for (const m of msgs) {
    for (const aid of m.attachmentIds) await tx.objectStore("attachments").delete(aid);
    await tx.objectStore("messages").delete(m.id);
  }
  await tx.objectStore("chats").delete(id);
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["chats", "messages", "attachments"], "readwrite");
  await tx.objectStore("chats").clear();
  await tx.objectStore("messages").clear();
  await tx.objectStore("attachments").clear();
  await tx.done;
}

/* ------------------------------ messages ----------------------------- */

export async function addMessage(msg: StoredMessage): Promise<void> {
  const db = await getDB();
  await db.put("messages", msg);
  await updateChat(msg.chatId, {});
}

export async function getMessages(chatId: string): Promise<StoredMessage[]> {
  const db = await getDB();
  const list = await db.getAllFromIndex("messages", "by-chat-created", IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]));
  return list;
}

export async function deleteMessage(id: string): Promise<void> {
  await (await getDB()).delete("messages", id);
}

/* ----------------------------- attachments --------------------------- */

export async function putAttachment(a: StoredAttachment): Promise<void> {
  await (await getDB()).put("attachments", a);
}

export async function getAttachment(
  id: string,
): Promise<StoredAttachment | undefined> {
  return (await getDB()).get("attachments", id);
}

export async function getAttachments(
  ids: string[],
): Promise<StoredAttachment[]> {
  const db = await getDB();
  const out: StoredAttachment[] = [];
  for (const id of ids) {
    const a = await db.get("attachments", id);
    if (a) out.push(a);
  }
  return out;
}

/* ------------------------------ settings ----------------------------- */

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await (await getDB()).put("settings", value, key);
}

export async function loadSetting<T>(key: string): Promise<T | undefined> {
  return (await getDB()).get("settings", key) as Promise<T | undefined>;
}

/* --------------------------- blob conversion ------------------------- */

/** Convert a stored attachment into a wire part for the API. */
export async function attachmentToPart(
  a: StoredAttachment,
): Promise<ContentPart | null> {
  const buf = await a.blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  if (a.mimeType.startsWith("image/")) {
    return { type: "image", mimeType: a.mimeType, dataBase64: base64 };
  }
  if (a.mimeType === "application/pdf") {
    return {
      type: "document",
      mimeType: a.mimeType,
      dataBase64: base64,
      name: a.name,
    };
  }
  // Anything else is sent as extracted text, not raw bytes.
  if (a.extractedText) {
    return {
      type: "text",
      text: `\n\n--- Attached file: ${a.name} ---\n${a.extractedText}\n--- end of ${a.name} ---\n`,
    };
  }
  return null;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Estimate the stored size of the whole database. */
export async function estimateUsage(): Promise<{ usedMB: number; quotaMB: number }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usedMB: 0, quotaMB: 0 };
  }
  const est = await navigator.storage.estimate();
  return {
    usedMB: (est.usage ?? 0) / 1024 / 1024,
    quotaMB: (est.quota ?? 0) / 1024 / 1024,
  };
}
