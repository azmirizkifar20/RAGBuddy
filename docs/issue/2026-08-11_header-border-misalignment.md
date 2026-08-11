# Sidebar and topbar bottom borders look misaligned on the AI Chat page

**Date:** 2026-08-11
**Status:** Fixed

## Symptom

On `/chat/:projectId`, the sidebar header's bottom border (under the RAGBuddy logo) and the
topbar's bottom border (under the "AI Chat / rhapsodie-shell" breadcrumb) visibly step at the
vertical seam where the two meet — the topbar's border reads slightly higher than the sidebar's.

## Root Cause

Not a geometry bug. `getBoundingClientRect()` on both header elements returned identical values
(`y: 0, height: 56`, `border-bottom-width: 1px`, `box-sizing: border-box` — pixel-for-pixel the
same box). A raw pixel-luminance scan of a real screenshot (via Playwright + `pngjs`, at
`deviceScaleFactor: 1.25`/`1.5` — common Windows display-scaling values, needed to make the effect
visible at all) confirmed the border row itself lands on the exact same row for every column
tested, sidebar and topbar alike.

The actual cause is an optical illusion from a genuine color mismatch, not a position mismatch:
`--sidebar` (the sidebar's background) and `--background` (the topbar's, via `AppShell`'s
`<header>`) are deliberately different shades — a common, intentional pattern to visually separate
chrome from content. In dark mode specifically this gets a second contributing factor:
`--sidebar-border` (9% white alpha) and `--border` (11% white alpha) also differ slightly, and
both are alpha-blended over their respective (different) backgrounds. Two abutting regions of
different brightness sharing one straight dividing line is a classic simultaneous-contrast
illusion — the line reads as "stepped" at the boundary even though it's dead straight, and it's
most visible right at this specific sidebar/topbar seam because that's the one place two
independently-styled chrome regions sit edge-to-edge along a shared horizontal line.

Confirmed by elimination — neither of these fixed it:
- Removing `backdrop-blur-md` from the topbar (ruled out GPU-layer-promotion rounding)
- Removing the topbar's background transparency (`bg-background/80` → `bg-background`, ruled out alpha compositing)
- Matching `--sidebar-border`'s alpha to `--border`'s (reduced the effect slightly but didn't remove it — the background-color difference was the dominant factor, not the border color)

What did fix it: making the topbar match the *sidebar's* background/border tokens instead of the
main content's, for exactly this one row.

## Fix

`web/src/components/layout/app-shell.tsx`: the topbar `<header>` now uses `bg-sidebar/80
border-sidebar-border` instead of `bg-background/80 border-b` (default border color). The content
below the topbar (`<main>`) is untouched — still `bg-background`, so the deliberate
sidebar-vs-content shade distinction survives everywhere except this one shared seam.

## Verification

Playwright + `pngjs` pixel-luminance scan across the sidebar/topbar boundary, before and after,
at `deviceScaleFactor` 1 (no visible issue — this is why the bug wasn't obvious in a plain
localhost check), 1.25, and 1.5 (both show the step clearly before the fix, and a seamless
luminance transition after), in both dark and light themes. No automated test — this is a purely
visual token-consistency issue with no meaningful behavior to assert on beyond "the two header
elements now share the same background/border token."

## Related

- [../design-system/README.md](../design-system/README.md) — Layout section
