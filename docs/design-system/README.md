# Design System — `web/` dashboard

**Status: Implemented**. The dashboard is an internal, single-user, localhost-only tool — this document records the conventions it actually follows so future changes stay coherent, not a product-grade design system.

Source of truth for tokens: [`web/src/index.css`](../../web/src/index.css). Primitives live in `web/src/components/ui/`, composed components in `web/src/components/`, layout chrome in `web/src/components/layout/`.

## 1) Foundations

### Colour tokens

All colours are OKLCH CSS variables defined twice — once on `:root` (light) and once on `.dark` — then mapped into Tailwind via `@theme inline`. Never hard-code a hex or an `oklch()` literal in a component; use the token.

| Token | Tailwind class | Used for |
|-------|----------------|----------|
| `--brand` | `bg-brand` / `text-brand` | The single accent hue (violet). Icons, active nav, focus ring, primary actions. |
| `--brand-soft` | `bg-brand-soft` | Tinted background behind brand icons and highlight panels. |
| `--accent-cyan` | `text-accent-cyan` | Second hue, used only for gradients and the retrieval-flow diagram. |
| `--success` / `--warning` / `--info` | `text-success`, `bg-warning/12`, … | Run status, score chips, stat-card tones. |
| `--destructive` | `text-destructive` | Errors and destructive actions only. |
| `--card`, `--muted`, `--border`, `--sidebar*` | standard shadcn tokens | Surfaces and chrome. |

Semantic pairing rule: a coloured icon sits on its own `/12` tint (`bg-success/12 text-success`), never on a saturated fill.

### Typography

- `--font-sans`: Geist Variable — all UI text.
- `--font-heading`: same family, applied via `font-heading` on headings so a future heading face is a one-token change.
- `--font-mono`: Geist Mono Variable — every file path, project id, config value, CLI command and log line. If it is something the user could paste into a terminal or a config file, it is mono.

### Radius & elevation

`--radius: 0.7rem`. Cards use `rounded-xl`, controls `rounded-lg`, badges `rounded-4xl`.

Elevation is expressed with `ring-1 ring-foreground/10` rather than borders, so cards read consistently in both themes. Shadows appear only on hover (`hover:shadow-md` / `hover:shadow-lg`), never at rest.

### Motion

Keyframes are defined in `index.css` and exposed as `--animate-*` theme values, so they are used as Tailwind utilities (`animate-fade-up`, `animate-float`, `animate-pulse-glow`, `animate-dash`, `animate-blink`, `animate-shimmer`).

Conventions:
- **Page and section entry**: `animate-fade-up` (400ms, `cubic-bezier(0.16, 1, 0.3, 1)`).
- **Lists**: wrap in `.stagger` and set `style={{ '--stagger-index': i }}` per child — 45ms apart, capped around index 12 so long lists do not crawl.
- **Hover**: `transition-all duration-200/300` with a ≤4px translate and/or a `scale-110` on the icon. Never move the whole card more than `-translate-y-1`.
- **Live/running state**: `animate-pulse-glow` on a dot, `animate-spin` on a refresh icon, `animate-blink` on the console caret.
- **Reduced motion**: a global `@media (prefers-reduced-motion: reduce)` block flattens every animation and transition. Any new animation inherits this automatically — do not add inline `animation` styles that bypass it.

## 2) Layout

`AppShell` (`web/src/components/layout/app-shell.tsx`) is the only page frame:

- Fixed 16rem sidebar (`lg:pl-64` on the content), off-canvas below `lg` with a backdrop.
- Sticky 3.5rem topbar: menu button (mobile), breadcrumb derived from the route, theme toggle, add-project button.
- Content is `max-w-6xl` centred with responsive padding.

`Sidebar` has three sections: workspace nav → current-project nav (only when a project route is active) → all-projects list. The active item gets a `bg-sidebar-accent` fill plus a 2px brand bar via the `ActiveBar` sub-component.

`PageHeader` is the standard page opener: optional tinted icon tile, title, description, right-aligned actions.

## 3) Components

| Component | File | Role |
|-----------|------|------|
| `StatCard` | `components/stat-card.tsx` | Metric tile with a toned icon; `tone` picks the semantic colour. |
| `ProjectCard` | `components/project-card.tsx` | Project tile with counts, hook state, inline sync. Top gradient bar scales in on hover. |
| `EmptyState` | `components/empty-state.tsx` | Dashed panel with a floating icon; every list renders this instead of bare text. |
| `RunList` | `components/run-list.tsx` | Timeline of sync-history runs, per-kind icon and per-trigger label. |
| `LogStream` | `components/log-stream.tsx` | Ingest/sync console with SSE lines, auto-scroll, blinking caret. |
| `UploadPanel` | `components/upload-panel.tsx` | Drag-and-drop uploader plus the uploaded-document list. |
| `FlowDiagram` | `components/flow-diagram.tsx` | Reusable interactive pipeline diagram (animated SVG connectors, click a stage for detail). |
| `CopyButton` / `CodeBlock` | `components/copy-button.tsx` | Copy affordance used across the MCP setup and settings pages. |

Primitives added on top of the original shadcn set: `tabs`, `tooltip`, `separator`, `skeleton`, `table`, `textarea`.

## 4) Rules

- **Icons**: `lucide-react` only (already a dependency — no icon font is installed). Size `size-4` inline, `size-4.5` inside a tile, `size-3.5` in small buttons. Every icon-only button needs an `aria-label`.
- **Loading**: `Skeleton` blocks that match the shape of the real content. Never a bare "Loading…" string.
- **Errors**: inline `text-sm text-destructive` next to the thing that failed; `toast.error` for actions the user triggered.
- **Destructive actions**: always behind an `AlertDialog` that states exactly what is and is not deleted.
- **Dark mode**: `next-themes` with `attribute="class"`, defaulting to dark. Every colour must come from a token so both themes work without per-component overrides.
- **Data fetching**: components never call `fetch` directly — everything goes through `web/src/lib/api-client.ts`. The project list is fetched once by `ProjectsProvider` and shared.

## Cross-References

- Feature doc: [../features/08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md)
- Original web feature: [../features/07-web-frontend-and-project-cli.md](../features/07-web-frontend-and-project-cli.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
