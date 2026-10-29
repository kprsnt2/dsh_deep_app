# All-in-One Chat

A personal chat app with **selectable agents** and a **multi-provider model fallback chain**.
Built to solve one specific problem: ChatGPT and Claude cap how many attachments you can
send, and this does not.

- **15 agents** tuned for different jobs (bedtime stories, worksheets, medical reports,
  data analysis, and more)
- **4-tier model fallback** — OpenAI → Gemini → NVIDIA → Groq, so one outage never stops you
- **Up to 20 attachments per message** — images, PDFs, CSVs, DOCX, text, pasted screenshots,
  and camera capture
- **Privacy mode** that routes sensitive chats to Gemini only
- **Print-ready PDF export** for worksheets
- Everything stored **in your browser** — nothing on a server you don't control

---

## Quick start

```bash
# 1. Install
pnpm install

# 2. Add your API keys
cp .env.example .env.local
#    then edit .env.local and paste in at least one key

# 3. Run
pnpm dev
#    open http://localhost:3000
```

The passcode screen appears first. Enter whatever you set as `APP_PASSCODE`
in `.env.local` (leave it blank to disable the lock entirely).

---

## ⚠️ First thing to do: verify your model IDs

You asked for `gpt-5.4-mini` and `gpt-5.4-nano` as defaults. **I could not verify those
model IDs exist.** Provider model names change frequently, and a wrong ID fails silently —
the router just skips that tier and quietly uses the next one, so the app keeps working
but you are not using the model you think you are.

**Check them now:**

1. Open the app → **Settings & models** (bottom of the sidebar)
2. Click **Test models**
3. It queries each provider's live model list and tells you which of your IDs are real,
   and suggests the closest actual match when one is wrong

Then correct the IDs in **one file**: [`src/config/models.ts`](src/config/models.ts).
Nothing else in the app hardcodes a model name.

---

## How the fallback chain works

Each request walks the chain top to bottom. The first provider that answers wins, and the
UI shows which one actually served the reply (plus a "Why?" button listing every attempt
with timing and error text).

| # | Provider | Model | Trains on your data? |
|---|----------|-------|----------------------|
| 1 | OpenAI | `gpt-5.4-mini` | ⚠️ yes (free tier) |
| 2 | OpenAI | `gpt-5.4-nano` | ⚠️ yes (free tier) |
| 3 | Gemini | `gemini-flash-latest` | ✅ no (your paid key) |
| 4 | NVIDIA | `meta/llama-3.2-90b-vision-instruct` | ⚠️ yes |
| 5 | Groq | `llama-3.3-70b-versatile` | ⚠️ yes |

A tier is skipped when it fails for **any** reason: missing key, 401, 429 rate limit,
404 wrong model, 5xx outage, timeout, or an empty response.

Edit the order in [`src/config/models.ts`](src/config/models.ts) — reorder lines to
change priority, delete a line to drop a provider.

---

## Privacy mode

Click the **🔓 Standard / 🔒 Private** toggle in the top bar.

**Private mode means:** the request goes to **Gemini only** — your paid key, which does
not train on your data.

### Two things you should know

**1. Doctor and Psycho always use private routing**, even when the toggle is off.
Medical and psychological content is sensitive by default. (Controlled by
`ALWAYS_PRIVATE_AGENTS` in the config.)

**2. Soft fallback is ON, and it can leak.** You chose soft fallback, so if Gemini is
down the app *will* fall through to OpenAI. Because your OpenAI key is free-tier, that
means private content could be used for training.

When that happens the app does not hide it:
- A **red banner** appears on the message: "PRIVATE DATA SENT TO A TRAINING PROVIDER"
- The message is **flagged permanently** in your saved history

**To forbid this entirely**, set one line in [`src/config/models.ts`](src/config/models.ts):

```ts
export const PRIVACY_ALLOW_SOFT_FALLBACK = false;
```

Then a Gemini outage fails the request with a clear error instead of leaking. Given the
content types here — prescriptions, lab reports, mental health — I'd suggest turning this
on. It's your call, and it's one line either way.

---

## The agents

### Your seven

| Agent | What it does |
|-------|--------------|
| 🌙 **KidStory** | Bedtime stories that double as reading practice. Child-safe by construction, with a "Read Together" question block and a "Words to Practise" list. |
| 📚 **StudyBuddy** | Explains simply, then goes deeper, then a worked example, then checks your understanding before revealing answers. |
| 📝 **Worksheet** | Printable sheets from a topic, grade, or photo of a textbook page. Exports to print-ready PDF. |
| 📊 **DataAnalyst** | SQL, Looker Studio calculated fields, Tableau LOD expressions, Excel/Sheets formulas, pandas. Reads your actual CSV columns. |
| 🩺 **Doctor** | Transcribes prescriptions and reports, explains them plainly, flags out-of-range values in a table, and lists questions to ask your real doctor. Always private. |
| 🧠 **Psycho** | A calm, judgement-free listener using CBT/ACT techniques, with a crisis protocol built in. Always private. |
| 🕉️ **Spiritual** | Life and meaning questions, drawing on multiple traditions while being honest about where they disagree. |

### Eight more I added

You said "all in one — all scenario covered", so I filled the obvious gaps:

| Agent | What it does |
|-------|--------------|
| 🎯 **LifeCoach** | Goals, habits, routines, getting unstuck. |
| 💼 **Career** | Resumes, interviews, salary negotiation. Reads your actual resume and shows before → after. |
| ✍️ **Writer** | Emails, essays, posts, translations, tone fixes. Shows original vs rewrite. |
| 🍳 **Chef** | Meals from what's actually in your kitchen. Reads a fridge photo. Food-safety aware. |
| 💰 **Finance** | Budgets, EMIs, loans, tax basics, investing concepts. Refuses to handle account numbers. |
| 🛠️ **TechFix** | Debugging, errors, environment setup. Warns before destructive commands. |
| 💬 **General** | Everyday questions with no specialism. |

Every agent is defined in [`src/config/agents.ts`](src/config/agents.ts). To add your own,
append one object to the `AGENTS` array — no other file needs changing.

---

## Attachments

**Up to 20 files per message**, 24 MB total. This is the feature you came for.

| Type | How it's handled |
|------|------------------|
| **Images** | Auto-downscaled to 1600px and re-encoded as JPEG, so a 4 MB phone photo becomes ~380 KB. You can attach 10+ prescription photos in one go. |
| **PDFs** | Text extracted locally via PDF.js *and* the raw file kept — so Gemini can OCR scanned reports that have no text layer. |
| **CSV** | Parsed locally: column names, inferred types, distinct counts, and a 40-row sample. The model gets your real column names instead of inventing them. |
| **DOCX** | Text extracted from the document XML. |
| **Text / code** | Sent as text, truncated at 200k characters with a notice. |
| **Screenshots** | Paste anywhere on the page with Ctrl+V. |
| **Camera** | 📷 button opens the camera on mobile. |

Drag and drop works anywhere on the composer. Files that can't be sent are still saved and
clearly marked with the reason, rather than failing silently.

---

## Worksheet PDFs

Ask the Worksheet agent for a sheet, then click **⬇ Print / PDF** on the reply.

The PDF is laid out specifically for printing on A4:
- Name / Date / Score header
- Real blank space after each question for working out
- The **Answer Key gets compact spacing** and no writing room, so it doesn't waste pages
- Page numbers, and correct pagination

A sample is in [`sample-output/sample-worksheet.pdf`](sample-output/sample-worksheet.pdf).

Every other agent's replies can also be exported to PDF with the same button.

---

## Where your data lives

**Entirely in your browser's IndexedDB.** Chats, messages and attachments never touch a
server you don't control.

- **API keys stay server-side** in `.env.local` — the browser only ever learns whether a
  key is configured, never its value
- Settings shows your storage usage and has a **Delete all local data** button
- Chat history sent to the model is capped at the last 16 turns

**The one honest caveat:** your messages obviously *are* sent to whichever AI provider
answers. "Local storage" means the history is local — not that the model sees nothing.
Privacy mode controls *which* provider sees it.

---

## Deployment

The app is framework-agnostic Next.js, so it runs anywhere. Two notes that matter:

**Serverless timeout.** The fallback chain can take a while if several providers fail in
sequence. `TIER_TIMEOUT_MS` (default 45s) caps each tier, so 4 failing tiers is up to
~3 minutes worst case — longer than many default serverless limits.

- **Vercel:** set `maxDuration` (already `300` in the route) and be aware that the free
  tier caps lower. Consider reducing `TIER_TIMEOUT_MS`.
- **Cloudflare Workers:** no `maxDuration`, but the CPU-time model differs. The request is
  I/O-bound (waiting on APIs), which Workers handles well.

**Environment variables.** Set `APP_PASSCODE` plus your provider keys in the host's
dashboard — same names as in `.env.example`. Never commit `.env.local`.

---

## Commands

```bash
pnpm dev          # development server
pnpm build        # production build
pnpm start        # run the production build
pnpm typecheck    # TypeScript check
pnpm test         # routing + markdown + PDF + end-to-end tests (75 assertions)
pnpm test:unit    # routing + markdown + PDF only (54 assertions)
pnpm test:e2e     # builds nothing: exercises `next start` against a mock provider
```

Individual suites:

```bash
node --import ./scripts/alias-hook.mjs --experimental-strip-types --no-warnings scripts/test-routing.ts
node --import ./scripts/alias-hook.mjs --experimental-strip-types --no-warnings scripts/test-markdown.ts
node --import ./scripts/alias-hook.mjs --experimental-strip-types --no-warnings scripts/test-pdf.ts
```

> `pnpm test:e2e` runs `next start`, so run `pnpm build` first.

---

## Framework version

Pinned to **Next.js 16.4.3** (React 19.3.1), which is past the patched 16.4.x line and
clears the "vulnerable version of Next.js" advisory raised against 15.1.6. Notable
changes made for the upgrade:

- **Turbopack is the default bundler** in `next dev` and `next build`. The old
  `webpack()` + `canvas` alias in `next.config.mjs` was removed; `pdfjs-dist`'s optional
  native `canvas` dependency resolves to empty and the PDF worker is created with
  `new URL(..., import.meta.url)` at runtime.
- `jsx` is now `react-jsx` (Next.js rewrote `tsconfig.json` during the first build) and
  `.next/dev/types/**/*.ts` was added to `include`.
- `next lint` was removed upstream (it is now `eslint` directly). The unused `lint`
  script was dropped rather than pulling in a new ESLint setup.
- `onlyBuiltDependencies: [sharp]` was added to `pnpm-workspace.yaml` so pnpm 10+ runs
  sharp's install script and Next.js stops warning about it.
- Node.js **>= 20.9** is required by Next.js 16 (`engines` in `package.json`).

---

## Project layout

```
src/
  config/
    models.ts        ← EDIT: model IDs, fallback order, privacy policy
    agents.ts        ← EDIT: agent prompts and personalities
  lib/
    providers.ts     ← provider adapters (OpenAI-compatible + Gemini)
    router.ts        ← fallback chain + privacy enforcement
    attachments.ts   ← image/PDF/CSV/DOCX/text processing
    storage.ts       ← IndexedDB persistence
    markdown.ts      ← safe Markdown renderer
    pdf.ts           ← print-ready PDF generation
  app/
    api/chat/        ← main chat endpoint (passcode-gated)
    api/config/      ← which providers are configured (never returns keys)
    api/test-models/ ← live model ID verification
    page.tsx         ← main UI
  components/        ← Sidebar, Composer, Message, Settings
scripts/             ← test suites + sample PDF generator
```

---

## Known limitations

- **`gpt-5.4-mini` / `gpt-5.4-nano` are unverified.** Test them in Settings before relying
  on them. This is the most likely thing to need a one-line fix.
- **No streaming.** Replies appear complete. Streaming across a multi-provider fallback
  chain is genuinely tricky — you can't show a partial reply and then switch providers
  mid-stream without the text jumping.
- **Groq cannot receive images.** It's last in the chain and text-only; the router handles
  this, but a Groq answer to an image question will be based on text alone.
- **No sync across devices.** Browser-only storage was your choice; clearing browser data
  deletes your chats.
- **Scanned PDFs need Gemini.** Only Gemini reads PDFs natively. A scanned report with no
  text layer will be invisible to OpenAI, NVIDIA and Groq.
