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
| `--brand` | `bg-brand` / `text-brand` | Accent hue (violet). Active tab underline, focus ring, primary buttons, inline links. Used sparingly. |
| `--success` / `--destructive` | `text-success`, `bg-destructive` | Run status dots and error text only. |
| `--warning` / `--info` / `--accent-cyan` | — | Defined for future use; currently unused by any component. |
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
| `animate-dash` | The flow-diagram connectors, where the direction of travel *is* the information. |
| `animate-shimmer` | Skeleton placeholders. |

A global `@media (prefers-reduced-motion: reduce)` block flattens every animation and transition. Any new animation inherits this automatically — do not add inline `animation` styles that bypass it.

## 2) Layout

`AppShell` (`web/src/components/layout/app-shell.tsx`) is the only page frame:

- Fixed 15rem sidebar (`lg:pl-60` on the content), off-canvas below `lg` with a backdrop.
- Sticky 3.5rem topbar: menu button (mobile), breadcrumb derived from the route, theme toggle, add-project button.
- Content is `max-w-6xl` centred with responsive padding.

`Sidebar` has exactly two sections: the four workspace links, then a flat list of every project. **It never expands a per-project sub-menu** — inside a project, navigation is the tab bar owned by `ProjectLayout`, so there is only ever one place to look for the current level of navigation.

`PageHeader` is the standard page opener: title, description, right-aligned actions. No icon.

## 3) Components

| Component | File | Role |
|-----------|------|------|
| `StatRow` | `components/stat-row.tsx` | Metrics as one hairline-divided row of label/number cells. |
| `ProjectCard` | `components/project-card.tsx` | Project tile: name, hook state, repo path, counts, sync action. |
| `RunTable` | `components/run-table.tsx` | Sync-history table — when, project, action, trigger, result, details, duration. |
| `EmptyState` | `components/empty-state.tsx` | Dashed panel with a muted icon; every list renders this instead of bare text. |
| `LogStream` | `components/log-stream.tsx` | Ingest/sync console with SSE lines, auto-scroll, blinking caret. |
| `UploadPanel` | `components/upload-panel.tsx` | Drag-and-drop uploader plus the uploaded-document list. |
| `FlowDiagram` | `components/flow-diagram.tsx` | Reusable interactive pipeline diagram (dashed SVG connectors, click a stage for detail). |
| `CopyButton` / `CodeBlock` | `components/copy-button.tsx` | Copy affordance used across the MCP setup and settings pages. |

Primitives added on top of the original shadcn set: `tabs`, `tooltip`, `separator`, `skeleton`, `table`, `textarea`.

**Tabular data goes in a `Table`**, not in a stack of cards — sync history, indexed documents, and any future list with more than two attributes per row.

## 4) Rules

- **Icons**: `lucide-react` only (already a dependency — no icon font is installed). They appear in navigation, buttons, and empty states; not decoratively beside headings. Size `size-4` inline, `size-3.5` in small buttons. Every icon-only button needs an `aria-label`.
- **Loading**: `Skeleton` blocks that match the shape of the real content. Never a bare "Loading…" string.
- **Errors**: inline `text-sm text-destructive` next to the thing that failed; `toast.error` for actions the user triggered.
- **Destructive actions**: always behind an `AlertDialog` that states exactly what is and is not deleted.
- **Dark mode**: `next-themes` with `attribute="class"`, defaulting to dark. Every colour must come from a token so both themes work without per-component overrides.
- **Data fetching**: components never call `fetch` directly — everything goes through `web/src/lib/api-client.ts`. The project list is fetched once by `ProjectsProvider` and shared.

## Cross-References

- Feature doc: [../features/08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md)
- Original web feature: [../features/07-web-frontend-and-project-cli.md](../features/07-web-frontend-and-project-cli.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
