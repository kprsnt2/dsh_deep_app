"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { processFile } from "@/lib/attachments";
import { MAX_ATTACHMENT_MB, MAX_IMAGES_PER_MESSAGE } from "@/config/models";

export interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  extractedText?: string;
  sendable: boolean;
  note?: string;
  /** Object URL for image previews. */
  previewUrl?: string;
  processing?: boolean;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  attachments: PendingAttachment[];
  setAttachments: (a: PendingAttachment[]) => void;
  disabled?: boolean;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
  hint?: string;
}

export default function Composer({
  value,
  onChange,
  onSend,
  attachments,
  setAttachments,
  disabled,
  busy,
  onStop,
  placeholder,
  hint,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [busyFiles, setBusyFiles] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  // Touch screens have no Enter key, so "Enter to send" means nothing there.
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? "ontouchstart" in window);
  }, []);

  // Auto-grow the textarea. Phones get a smaller ceiling so the input box
  // never eats the conversation above it.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, touch ? 160 : 260)}px`;
  }, [value, touch]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const incoming = [...attachments];
      const newNotices: string[] = [];
      setBusyFiles((n) => n + files.length);

      for (const file of files) {
        // Guard against absurdly large single files before we even read them.
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
          newNotices.push(
            `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB and was skipped (over the ${MAX_ATTACHMENT_MB} MB limit).`,
          );
          setBusyFiles((n) => n - 1);
          continue;
        }

        const imageCount = incoming.filter((a) =>
          a.mimeType.startsWith("image/"),
        ).length;
        const isImage = file.type.startsWith("image/");
        if (isImage && imageCount >= MAX_IMAGES_PER_MESSAGE) {
          newNotices.push(
            `Skipped ${file.name}: the limit is ${MAX_IMAGES_PER_MESSAGE} images per message.`,
          );
          setBusyFiles((n) => n - 1);
          continue;
        }

        try {
          const { attachment, notice } = await processFile(file);
          if (notice) newNotices.push(`${file.name}: ${notice}`);
          const pending: PendingAttachment = {
            ...attachment,
            previewUrl: attachment.mimeType.startsWith("image/")
              ? URL.createObjectURL(attachment.blob)
              : undefined,
          };
          incoming.push(pending);
          // Show progress as files finish, rather than all at the end.
          setAttachments([...incoming]);
        } catch (err) {
          newNotices.push(
            `${file.name} could not be read: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
        setBusyFiles((n) => n - 1);
      }

      setAttachments(incoming);
      if (newNotices.length) {
        setNotices(newNotices);
        setTimeout(() => setNotices([]), 9000);
      }
    },
    [attachments, setAttachments],
  );

  // Global paste handler so screenshots can be pasted anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const remove = (id: string) => {
    const target = attachments.find((a) => a.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend && !busy) onSend();
    }
  };

  const totalMB =
    attachments.reduce((s, a) => s + a.size, 0) / 1024 / 1024;

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-sky-400 bg-sky-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <p className="text-sky-200 font-medium">Drop files to attach</p>
        </div>
      )}

      {/* ---------- notices ---------- */}
      {notices.length > 0 && (
        <div className="mb-2 space-y-1">
          {notices.map((n, i) => (
            <div
              key={i}
              className="text-[12px] text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-1.5"
            >
              {n}
            </div>
          ))}
        </div>
      )}

      {/* ---------- attachment strip ---------- */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="group relative flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 p-1.5 pr-2 max-w-[240px]"
            >
              {a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.previewUrl}
                  alt={a.name}
                  className="h-11 w-11 rounded-lg object-cover"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-ink-800 flex items-center justify-center text-lg">
                  {fileGlyph(a.mimeType, a.name)}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-[12px] text-gray-200">{a.name}</p>
                <p className="text-[10px] text-gray-500">
                  {(a.size / 1024).toFixed(0)} KB
                  {!a.sendable && " · not sendable"}
                </p>
              </div>
              <button
                onClick={() => remove(a.id)}
                className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-ink-700 hover:bg-red-600 text-white text-xs flex items-center justify-center opacity-100 transition sm:h-5 sm:w-5 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {attachments.some((a) => a.note) && (
        <div className="mb-2 space-y-1">
          {attachments
            .filter((a) => a.note)
            .map((a) => (
              <div
                key={a.id}
                className="text-[11px] text-gray-400 bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5"
              >
                <span className="text-gray-300">{a.name}:</span> {a.note}
              </div>
            ))}
        </div>
      )}

      {/* ---------- input box ---------- */}
      <div className="rounded-2xl border border-ink-700 bg-ink-850 focus-within:border-ink-600 transition">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          enterKeyHint="send"
          placeholder={placeholder ?? "Type a message…"}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none placeholder:text-gray-600 disabled:opacity-50 sm:text-[15px]"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <IconBtn label="Attach files" onClick={() => fileRef.current?.click()}>
            📎
          </IconBtn>
          <IconBtn label="Take photo" onClick={() => camRef.current?.click()}>
            📷
          </IconBtn>

          {attachments.length > 0 && (
            <span className="ml-1 truncate text-[11px] text-gray-500">
              {attachments.length} file{attachments.length > 1 ? "s" : ""} ·{" "}
              {totalMB.toFixed(1)} MB
            </span>
          )}

          <div className="flex-1" />

          {busyFiles > 0 && (
            <span className="mr-2 truncate text-[11px] text-sky-400 animate-pulse-soft">
              {touch ? "…" : "processing"} {busyFiles}…
            </span>
          )}

          {busy ? (
            <button
              onClick={onStop}
              className="h-10 shrink-0 rounded-xl bg-ink-700 hover:bg-red-600 px-4 text-sm font-medium transition sm:h-auto sm:py-2"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend || busyFiles > 0}
              className="h-10 shrink-0 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-ink-700 disabled:text-gray-500 px-4 text-sm font-medium transition sm:h-auto sm:py-2"
            >
              Send
            </button>
          )}
        </div>
      </div>

      {/* The agent's attachment hint is useful on a phone but too long in
          full, so it gets one clamped line there. */}
      <p className="mt-1.5 px-1 text-[11px] text-gray-600">
        {hint ? (
          <>
            <span className="line-clamp-1 sm:line-clamp-none">{hint}</span>
            <span className="hidden sm:inline"> · </span>
          </>
        ) : null}
        <span className="hidden sm:inline">
          Enter to send · Shift+Enter for a new line · Paste screenshots anywhere
        </span>
        <span className="sm:hidden">
          Paste screenshots · up to {MAX_IMAGES_PER_MESSAGE} images per message
        </span>
      </p>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-10 w-10 rounded-xl hover:bg-ink-700 flex items-center justify-center text-base transition sm:h-9 sm:w-9"
    >
      {children}
    </button>
  );
}

function fileGlyph(mime: string, name: string): string {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) return "📄";
  if (mime.includes("csv")) return "📈";
  if (name.toLowerCase().endsWith(".docx")) return "📝";
  if (mime.startsWith("text/")) return "📃";
  return "📁";
}
