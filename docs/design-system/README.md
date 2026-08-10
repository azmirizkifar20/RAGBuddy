# Design System — `web/` dashboard

**Status: Implemented**. The dashboard is an internal, single-user, localhost-only tool. This document records the conventions it actually follows so future changes stay coherent — it is not a product-grade design system.

Source of truth for tokens: [`web/src/index.css`](../../web/src/index.css). Primitives live in `web/src/components/ui/`, composed components in `web/src/components/`, layout chrome in `web/src/components/layout/`.

## 0) Intent

This is an engineering tool, so it should read like one: **data first, chrome last**. Concretely, the things it deliberately does *not* do:

- No tinted icon tile next to every heading or metric.
- No gradient text, gradient borders, or hover glow halos.
- No decorative motion — nothing floats, pulses, or staggers just to look alive.
- No badge where plain text says the same thing.

Colour, motion and iconography are reserved for carrying meaning (state, direction, affordance). If an element can be removed without losing information, it is removed.

## 1) Foundations

### Colour tokens

All colours are OKLCH CSS variables defined twice — once on `:root` (light) and once on `.dark` — then mapped into Tailwind via `@theme inline`. Never hard-code a hex or an `oklch()` literal in a component; use the token.

| Token | Tailwind class | Used for |
|-------|----------------|----------|
| `--brand` | `bg-brand` / `text-brand` | Accent hue (blue, matching the RAGBuddy logo). Active tab underline, focus ring, primary buttons, inline links. Used sparingly. |
| `--success` / `--destructive` | `text-success`, `bg-destructive` | Run status dots and error text only. |
| `--warning` / `--info` / `--accent-cyan` | — | Defined for future use; currently unused by any component. |
| `--chart-1` / `--chart-2` / `--chart-4` | `bg-chart-1` etc. | Categorical trio for `ActivityChart` (ingest/sync/upload). Light values mirror `--brand`/`--accent-cyan`/`--warning`; dark values are tuned separately to a tighter lightness band (~0.48-0.67) so chart marks read clearly against the dark surface — validated with the `dataviz` skill's `validate_palette.js` (all-pairs CVD + normal-vision ΔE ≥ 15). `--chart-3`/`--chart-5` stay reserved for status (success/destructive), never repurposed as a categorical hue. |
| `--card`, `--muted`, `--border`, `--sidebar*` | standard shadcn tokens | Surfaces and chrome. |

### Typography

- `--font-sans`: Geist Variable — all UI text.
- `--font-heading`: same family, applied via `font-heading` on headings and large numbers, so a future heading face is a one-token change.
- `--font-mono`: Geist Mono Variable — every file path, project id, config value, CLI command and log line. If it is something the user could paste into a terminal or a config file, it is mono.

Hierarchy comes from size and weight, not colour: page title is `text-lg font-semibold`, section headings are `text-sm font-medium`, supporting copy is `text-sm text-muted-foreground`.

### Surfaces & radius

`--radius: 0.5rem`. Cards, tables and list containers use `rounded-lg border` — a single hairline, no ring, no shadow at rest. Grouped rows use `divide-y` inside one bordered container rather than a stack of separate cards.

Hover on an interactive card is a border-colour change (`hover:border-foreground/25`), not a lift or a shadow.

### Motion

Keyframes live in `index.css` and are exposed as `--animate-*` theme values, used as Tailwind utilities.

| Utility | Where it is allowed |
|---------|---------------------|
| `animate-fade-up` | Once per page, on the page's root element. Never per list item. |
| `animate-fade-in` | Content that swaps in place (tab panels, the flow-diagram detail pane). |
| `animate-spin` | A refresh icon while its request is in flight. |
| `animate-blink` | The console caret while a run is streaming. |
| `animate-pulse` | The streaming caret (`▍`) at the end of an in-progress chat reply, plus the `ThinkingDots` bounce. These are *state* indicators (reply in flight), not decoration. |
| `animate-bounce` | Chat `ThinkingDots` — the three bouncing dots shown while a reply streams. Same exception as `animate-pulse`. |
| `animate-dash` | The flow-diagram connectors, where the direction of travel *is* the information. |
| `animate-shimmer` | Skeleton placeholders. |

A global `@media (prefers-reduced-motion: reduce)` block flattens every animation and transition. Any new animation inherits this automatically — do not add inline `animation` styles that bypass it.

## 2) Layout

`AppShell` (`web/src/components/layout/app-shell.tsx`) is the only page frame:

- Sidebar is 15rem expanded (`lg:pl-60` on the content) or a 4rem icon rail when collapsed (`lg:pl-16`) — desktop-only, off-canvas below `lg` with a backdrop (mobile always renders the full 15rem overlay regardless of the collapsed flag).
- Sticky 3.5rem topbar: menu button (mobile), breadcrumb derived from the route, add-project button. The theme toggle lives in the sidebar footer, not the topbar.
- Content is `max-w-6xl` centred with responsive padding.

`Sidebar` has exactly two nav sections: the five workspace links (Dashboard, AI Chat, Projects, How RAG works, Settings), then a flat list of every project. **It never expands a per-project sub-menu** — inside a project, navigation is the tab bar owned by `ProjectLayout`, so there is only ever one place to look for the current level of navigation. `/chat` is one of the five top-level workspace links, not a project tab — see the `AiChat` row below.

The sidebar can collapse to an icon-only rail (`collapsed` state in `AppShell`, persisted in `localStorage` under `code-context-rag:sidebar-collapsed` (unchanged since before the rename), toggled by a button next to the logo). Collapsed: labels hide, each icon gets a `Tooltip` with its label, the per-project list disappears (names can't survive as icons), and the footer's segmented Light/Dark toggle falls back to the single-icon `ThemeToggle`. This is desktop-only — the mobile off-canvas sidebar is unaffected and always shows full labels.

`PageHeader` is the standard page opener: title, description, right-aligned actions. No icon. The one deliberate exception is the `/chat` picker screen's centered "Chat with a project" heading (see `AiChat` below) — a bigger centered heading used only because there is no single item to attach a `PageHeader` to yet (no project chosen).

## 3) Components

| Component | File | Role |
|-----------|------|------|
| `StatRow` | `components/stat-row.tsx` | Metrics as one hairline-divided row of label/number cells. |
| `ProjectCard` | `components/project-card.tsx` | Project tile: name, hook state, repo path, counts, sync action. |
| `RunTable` | `components/run-table.tsx` | Sync-history table — when, project, action, trigger, result, details, duration. |
| `EmptyState` | `components/empty-state.tsx` | Dashed panel with a muted icon; every list renders this instead of bare text. |
| `LogStream` | `components/log-stream.tsx` | Ingest/sync console with SSE lines, auto-scroll, blinking caret. |
| `ActivityChart` | `components/activity-chart.tsx` | Dashboard's 7-day ingest/sync/upload frequency, stacked bars in fixed categorical order (upload/sync/ingest, top to bottom), per-day hover/focus tooltip, legend, and a "View as table" toggle to the same data as a `Table` (accessibility twin, per the `dataviz` skill). |
| `UploadPanel` | `components/upload-panel.tsx` | Drag-and-drop uploader plus the uploaded-document list. |
| `FlowDiagram` | `components/flow-diagram.tsx` | Reusable interactive pipeline diagram (dashed SVG connectors, click a stage for detail). |
| `CopyButton` / `CodeBlock` | `components/copy-button.tsx` | Copy affordance used across the MCP setup and settings pages. |
| `FormattedChatMessage` | `components/formatted-chat-message.tsx` | Custom markdown renderer for chat replies — paragraphs, lists, inline code badges, striped scrollable tables, collapsible code blocks (>20 lines) with a copy button. Body text is `text-sm`, matching user bubbles. |
| `AiChat` page | `pages/ai-chat.tsx` | Top-level chat page at `/chat` and `/chat/:projectId`. No project in the URL → project-picker screen (centered heading, a card grid of registered projects with a `localStorage`-derived "N saved chat(s)" subtitle). A project chosen → the chat room: session sidebar, header (title + Use RAG `Switch`), message feed, input bar with file/image attachments. Sources render as clickable badges via the inline `SourcesList`. |

Primitives added on top of the original shadcn set: `tabs`, `tooltip`, `separator`, `skeleton`, `table`, `textarea`, `switch`, `label`.

**Tabular data goes in a `Table`**, not in a stack of cards — sync history, indexed documents, and any future list with more than two attributes per row.

## 4) Rules

- **Cursors**: Tailwind v4's preflight sets `cursor: default` on buttons, so `index.css` restores `cursor: pointer` once in the base layer for `button`, `a[href]`, `[role="button"|"tab"|"switch"|"menuitem"|"option"]`, `summary` and `select` — plus `cursor: not-allowed` for the disabled variants. Never add `cursor-pointer` per component; the only exceptions are non-semantic clickable `div`s (the mobile sidebar backdrop, the upload drop zone), which set it inline.
- **Icons**: `lucide-react` only (already a dependency — no icon font is installed). They appear in navigation, buttons, and empty states; not decoratively beside headings. Size `size-4` inline, `size-3.5` in small buttons. Every icon-only button needs an `aria-label`.
- **Loading**: `Skeleton` blocks that match the shape of the real content. Never a bare "Loading…" string.
- **Errors**: inline `text-sm text-destructive` next to the thing that failed; `toast.error` for actions the user triggered.
- **Destructive actions**: always behind an `AlertDialog` that states exactly what is and is not deleted.
- **Dark mode**: `next-themes` with `attribute="class"`, defaulting to dark. Every colour must come from a token so both themes work without per-component overrides.
- **Data fetching**: components never call `fetch` directly — everything goes through `web/src/lib/api-client.ts`. The project list is fetched once by `ProjectsProvider` and shared.

## Cross-References

- Feature doc: [../features/08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md)
- Project chat: [../features/09-project-chat.md](../features/09-project-chat.md)
- Original web feature: [../features/07-web-frontend-and-project-cli.md](../features/07-web-frontend-and-project-cli.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
