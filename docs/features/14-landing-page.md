# Landing Page

**Status: Implemented.** A self-contained static landing page in `landing/` that presents RAGBuddy to developers and coding-agent users: hero, feature grid, "how it works" steps, dashboard screenshot gallery, MCP section and a copy-paste quick start. Zero build step — one HTML file with embedded CSS and a few lines of vanilla JS. `ragbuddy web` serves it at `/` (the app itself moved to `/dashboard`); it also stays deployable to any static host (GitHub Pages, Netlify, `file://`, …).

## 1) What This Feature Is

1. **Static, build-free, single-file** — `landing/index.html` holds the full page (semantic HTML + embedded CSS + minimal JS). No `package.json`, no `node_modules`, no bundler. Screenshots and fonts are served as plain static assets.
2. **Brand-consistent** — the page mirrors the dashboard design system (`docs/design-system/README.md`): light-themed, same OKLCH tokens (background `oklch(0.965 0.006 285)`, brand blue `oklch(0.55 0.19 258)`, hairline borders, radius `0.5rem`), Geist Variable + Geist Mono self-hosted, mono for every command/path.
3. **No text branding** — the header and footer show only the logo in its full landscape aspect ratio, omitting the "RAGBuddy" text for a cleaner, modern look.
4. **Mobile-first responsive** — base font-size drops from 16px to 15px at `≤640px` so every `rem`-sized type shrinks consistently; all headings use `clamp()`. Layouts collapse: nav → hamburger dropdown (`≤767px`), features 4→2→1 columns, gallery 3→2→1, CTA buttons go full-width with a `3rem` (≥44px) touch target.
4. **Served by the backend at `/`, but still standalone** — `ragbuddy web` mounts `landing/` statically before the SPA bundle, so `/` answers the landing while `/dashboard/*` runs the app and `/login` the login screen (see `docs/steering/routing.md`). Because it's plain static files with only relative asset paths and external links, the same folder also works on any static host or via `file://`.
5. **Accessibility basics** — semantic landmarks (`header`/`nav`/`main`/`footer`), `aria-label`s on icon-only and mobile controls, `:focus-visible` rings, `prefers-reduced-motion` flattens all transitions, `alt` text on every screenshot.

## 2) Flow / Behavior

```
Visitor opens the site root — `ragbuddy web` → `/` (or any static host / file://)
  → hero: headline + "Try it on GitHub" CTA (primary, links to the repo — the only
    distribution channel, the package is not published) + "Quick start ↓" anchor
  → features grid (8) → how-it-works steps (3) → screenshot gallery (7)
  → MCP tools + `claude mcp add` snippet → quick-start terminal block

Interactions (vanilla JS, all optional-enhancement):
  → hamburger toggles the mobile nav (aria-expanded tracked)
  → clicking any gallery screenshot opens a lightbox; ✕ / backdrop / Esc closes it
  → "Copy" buttons write their code block to the clipboard (Clipboard API with
    execCommand fallback) and flip to "Copied" for ~1.8s
```

## 3) Structure

```
landing/
├── index.html   # the entire page: markup, embedded CSS, inline JS
├── images/      # screenshots (.webp, ≤1600px, each <130KB) + logo.png + icon.png
└── fonts/       # geist-latin(.ext).woff2, geist-mono-latin(.ext).woff2
                 # copied from web/node_modules/@fontsource-variable/{geist,geist-mono}
```

## 4) Content sections

| Section | Anchor | Content |
|---------|--------|---------|
| Nav | — | Sticky: landscape logo (no text), links (Features, How it works, Screens, MCP, API, Quick start), GitHub button; hamburger + dropdown below `768px` |
| Hero | `#top` | Badge ("open source · MIT · local-first"), headline "Project-aware RAG for coding agents", README-derived subcopy, **"Try it on GitHub"** (→ `https://github.com/azmirizkifar20/RAGBuddy`) + "Quick start ↓", "Works with Claude Code · OpenCode · Codex · Ollama · OpenAI-compatible", dashboard screenshot in a browser-frame mockup (mono URL bar `http://localhost:4300`) |
| Features | `#features` | 8 hairline cards: multi-project RAG isolation; git hook auto-sync; MCP server; one-shot CLI `ragbuddy ask`; web AI chat; document uploads; local-first & private; REST API for external apps |
| How it works | `#how-it-works` | 3 numbered steps: Register & index → Sync automatically → Ask anywhere |
| Screens | `#screens` | 7 screenshot cards with captions (AI chat, Retrieval search, Documents, Sync history, MCP setup, How RAG works, Project overview) + lightbox |
| MCP | `#mcp` | The 4 MCP tools (mono) + `claude mcp add ragbuddy` and `opencode` JSON configuration blocks with copy buttons |
| API | `#api` | The 2 RAG API endpoints (`/api/search` and `/api/chat`) with curl request and JSON/SSE response examples for integration into external apps |
| Quick start | `#quick-start` | Terminal block: clone → `npm install`/`npm run build` → `cp .env.example .env` → `docker compose up -d` → `ollama pull bge-m3` → `project register` → `ingest` → `ask`, with copy button |
| Footer | — | Landscape logo (no text), MIT note, GitHub / Documentation / Quick start links, stack line (`TypeScript · React · Qdrant · Ollama`) |

## 5) Screenshots

All gallery shots were captured from the live dashboard (dark mode, 1440×900 desktop viewport) against the local seeded instance (8 registered projects, 6397 chunks), then converted to WebP at ≤1600px / quality 80 — 3.4MB of PNGs became ~490KB. Files: `dashboard.webp`, `chat.webp` (live RAG answer with mermaid + related documents), `search.webp` (ranked results), `documents.webp`, `history.webp`, `mcp.webp`, `flow.webp`, `overview.webp`. Regenerating them is manual: start `npm run web`, log in at `/login`, and screenshot each `/dashboard/...` route.

## 6) Design notes / conventions

- **Copy is English** — consistent with the README and the docs.
- The repo's `images/` folder (README screenshots) is *not* reused by the landing; `landing/images/` keeps the landing self-contained and independently deployable.
- The design-system doc describes the internal dashboard; the landing follows the same tokens but with looser marketing spacing (larger hero type, more vertical rhythm) — no new tokens were introduced.
- Since the package is `"private": true` (not on npm), "Try it on GitHub" is the honest install CTA rather than a package-manager badge.

## 7) Verification

- All 15 assets (HTML, 8 webp screenshots, logo, icon, 4 woff2 fonts) served `200` from a plain static server.
- Served by `ragbuddy web` at `/` (verified: `/` returns the landing HTML; `/images/*.webp` and `/fonts/*.woff2` answer from `landing/`; SPA assets and `/dashboard/*` routes fall through to the bundle) — locked by `tests/server/static-serving.test.ts`.
- Browser-checked at 375 / 768 / 1280px: single-column collapse, hamburger toggle, computed font sizes (base 15px on mobile, hero `29.25px`, code `11.7px`), no horizontal overflow, ≥44px touch targets, lightbox open/close, copy-button feedback.
- No tests: a static page has no testable logic; verification is the browser pass above.
