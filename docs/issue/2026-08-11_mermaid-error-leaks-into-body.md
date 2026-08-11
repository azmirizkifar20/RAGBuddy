# Broken Mermaid diagram shows a giant raw error box below the chat input, not in the message

**Date:** 2026-08-11
**Status:** Fixed

## Symptom

Asking AI Chat something like "Jelaskan arsitektur project ini dengan diagram" produced a reply
whose Mermaid diagram had invalid syntax. Instead of a contained error notice inside the assistant
message, a large red "Syntax error in text / mermaid version 11.16.1" box appeared directly below
the chat input, pushing it upward — clearly not part of the message bubble at all.

## Root Cause

Two separate bugs in `MermaidBlock` (`web/src/components/mermaid-block.tsx`), both in mermaid
(bundled v11.16.1) itself, not in this app's own error text:

1. **`mermaid.render()` doesn't reliably throw on invalid syntax.** For many parse errors it
   substitutes its own internal `"error"` diagram type and *resolves* normally with that diagram's
   SVG (containing `error-icon`/`error-text`-classed elements and the literal text "Syntax error
   in text"). `MermaidBlock`'s try/catch only ever sees *rejected* promises — this class of failure
   sails straight past it and gets rendered as if it were a real, successful diagram.

2. **On the errors that *do* throw, mermaid still leaks DOM.** Traced through mermaid's own source
   (`node_modules/mermaid/dist/mermaid.js`): when no explicit container element is passed to
   `render()`, mermaid creates its own scratch element and appends it straight to
   `document.body`. On a parse error it draws its internal error-diagram SVG into that scratch
   element, sets `parseEncounteredException`, and *then* throws that exception — but the throw
   happens **before** its own `removeTempElements()` cleanup call. The scratch element (containing
   the giant error SVG) is permanently orphaned directly under `<body>`, completely outside
   React's tree. Verified directly with Playwright: `document.body`'s child count increases after
   a failed render with no container and stays flat when one is supplied. This explains the exact
   reported symptom — a leaked top-level DOM node renders whatever the browser lays out after it
   (in this case, visually below the sticky chat input, which is why it looked like it "pushed the
   input up").

A naive fix — passing a *fully detached* container (never attached to the document) to sidestep
the leak — breaks legitimate diagrams instead: flowchart rendering needs real layout (`getBBox`,
text measurement), which a detached element can't provide, and throws its own unrelated error
(`Cannot read properties of null (reading 'getAttribute')`) even for valid input. Verified by hand
before landing on the real fix below.

## Fix

`web/src/components/mermaid-block.tsx`:

1. After a successful `render()`, check the returned SVG for mermaid's own `error-icon`/`error-text`
   class markers (`isMermaidErrorSvg`) — these are deliberate, stable markers mermaid assigns only
   to its synthetic error diagram, not something real diagram content would ever produce. A match
   is treated identically to a thrown error (the existing "Invalid diagram" fallback box).
2. `render()` is now given an explicit container: a `<div>` positioned off-screen but still
   *attached* to `document.body` (`position: fixed; top/left: -10000px; visibility: hidden`) —
   real enough for layout measurement to work, invisible to the user. It is removed in a `finally`
   block unconditionally, so cleanup happens regardless of whether mermaid's own internal cleanup
   step ever runs.

Both fixes were verified directly against the real bundled mermaid package via Playwright before
being applied — not assumed from reading the source alone — including the failed first attempt
(fully detached container), to avoid trading one bug for another.

## Verification

No unit test (per the design system's existing "no automated frontend test suite" — Playwright
here was throwaway verification tooling, not a permanent addition): confirmed via Playwright
against the real bundled mermaid, and against the real running app with a seeded broken-diagram
chat message —
- a genuinely invalid diagram now shows the compact "Invalid diagram" box inline in the message
- `document.body`'s child count does not change across the render (no leak)
- a valid diagram still renders its real SVG unchanged

## Related

- [../design-system/README.md](../design-system/README.md) — `MermaidBlock` row
