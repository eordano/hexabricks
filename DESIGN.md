---
name: Hexabricks Browser
description: The shared building table; visual guidance scoped to web/.
colors:
  surface: "#172128"
  surface-raised: "#222e36"
  ink: "#f4f4ef"
  muted: "#a6b8bd"
  line: "#35464e"
  mint: "#91efce"
  ruby: "#ff4969"
  background: "#090d11"
  tool-selected: "#32483f"
  shape-selected: "#314c43"
  secondary-action: "#2b3a43"
  action-ink: "#190a0e"
  ruby-hover: "#ff6e88"
  disabled-action: "#3a454b"
  disabled-ink: "#c3cdd0"
  terracotta: "#C96542"
  terracotta-rim: "#E8DCB8"
  crimson: "#A32638"
  crimson-rim: "#EFE3B0"
  olive: "#A6C93F"
  olive-rim: "#6B7A2C"
  moss: "#5C6633"
  moss-rim: "#9DB33F"
  obsidian: "#17161A"
  obsidian-rim: "#34E5E0"
  bone: "#E8DCC0"
  sea: "#2E98A6"
  sea-rim: "#41E8E0"
  neon: "#8E3A62"
  neon-rim: "#FF4BED"
typography:
  headline:
    fontFamily: "'Trebuchet MS', 'Avenir Next', Avenir, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    letterSpacing: "-.025em"
  body:
    fontFamily: "'Trebuchet MS', 'Avenir Next', Avenir, sans-serif"
    fontSize: "14px"
  help-body:
    fontFamily: "'Trebuchet MS', 'Avenir Next', Avenir, sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
  label:
    fontFamily: "'Trebuchet MS', 'Avenir Next', Avenir, sans-serif"
    fontSize: "12px"
rounded:
  control: "9px"
  icon: "10px"
  rail: "14px"
  panel: "16px"
spacing:
  compact: "4px"
  related: "8px"
  control-gap: "10px"
  group: "12px"
  inset: "16px"
  panel: "24px"
components:
  button-apply:
    backgroundColor: "{colors.ruby}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
  button-apply-hover:
    backgroundColor: "{colors.ruby-hover}"
    textColor: "{colors.action-ink}"
  button-apply-disabled:
    backgroundColor: "{colors.disabled-action}"
    textColor: "{colors.disabled-ink}"
  button-rotate:
    backgroundColor: "{colors.secondary-action}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 8px"
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.icon}"
    width: "44px"
    height: "44px"
  tool-selected:
    backgroundColor: "{colors.tool-selected}"
    textColor: "{colors.mint}"
    rounded: "{rounded.control}"
    width: "44px"
    height: "44px"
  shape-selected:
    backgroundColor: "{colors.shape-selected}"
    textColor: "{colors.mint}"
    rounded: "{rounded.control}"
  help-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Hexabricks Browser

## Overview

**Creative North Star: "The Shared Building Table"**

This document governs the browser surface in `web/`. It records the implemented extension of the shared brick world and does not replace the Decentraland scene's incumbent identity. The world fills the viewport: a precise teal hex floor, recognizable shared materials, and luminous brick rims make building the visual focus.

Charcoal controls sit around the working area like compact tools. Mint identifies selection and readiness; ruby identifies the explicit apply action. The atmosphere is playful, precise, and calm enough for repeated placement. Native GPU geometry supplies the world; authored SVG supplies the interface icons.

**Key Characteristics:**

- A full native WebGPU world with an overhead building camera.
- Exact shared brick silhouettes, material pairs, heights, and triangular lattice.
- Opaque charcoal controls with mint selection and a ruby apply action.
- Reachable placement controls and explicit touch aim, then apply.
- A normal building view made of icons, actual shapes, colors, height stacks, and numbers. Words are available through help, hover titles, accessible names, and actionable errors.

Source authority: [browser direction contract](web/index.html), [styles](web/styles.css), [interaction states](web/main.ts), [renderer](web/renderer.ts), and [shared materials](src/brick-palette.ts). Update this record and `.impeccable/design.json` together when those visual decisions change.

## Colors

Deep blue charcoal supports the teal world, pale warm text, a fresh mint selection accent, and a vivid ruby action accent. Frontmatter values are normative for the extracted tokens; the shader remains authoritative for computed lighting and floor color.

### Primary

- **Mint:** selected tools and shapes, camera toggles, keyboard focus, live status, links, and brief successful-action feedback.
- **Ruby:** the tray's explicit Place, Paint, or Remove action. Its brighter hover variant adds feedback without changing the action's identity.

### Secondary

Shared brick materials retain their existing names and base/rim pairings. Swatches use base colors; lighting and rim treatment belong to the renderer.

| Material | Base token | Rim token |
| --- | --- | --- |
| Terracotta | `terracotta` | `terracotta-rim` |
| Crimson | `crimson` | `crimson-rim` |
| Olive | `olive` | `olive-rim` |
| Moss | `moss` | `moss-rim` |
| Obsidian | `obsidian` | `obsidian-rim` |
| Bone | `bone` | `obsidian` |
| Sea | `sea` | `sea-rim` |
| Neon | `neon` | `neon-rim` |

### Neutral

- **Surface / Surface Raised:** opaque containers and unselected shape tiles keep controls legible over dense builds.
- **Ink / Muted:** control symbols and explanatory text in help; keep the building view free of persistent labels.
- **Line:** rail separators, height selection, and visible scrollbars.
- **Background:** the dark viewport surround beyond the board.

**The Shared Material Rule.** Read material pairs from the shared palette. Do not recolor the browser's bricks independently of Decentraland.

## Typography

Use the single installed-font stack in the frontmatter. Its rounded, familiar letterforms keep compact controls approachable; no downloaded font or display typeface is required.

The identity is a small SVG mark. The help headline uses (23px); the exceptional compatibility heading uses (26px). Explanatory text lives in help, tooltips, and errors. Rotation, pending edits, and world counts use tabular numerals at (10–12px). Selected shape and material names remain available to assistive technology without taking up visual space.

## Layout

The canvas occupies the full dynamic viewport (`100dvh`). On desktop, the identity mark sits above the icon toolbar at the upper left; camera controls form a rail on the right. The bottom tray is centered with a maximum width of (560px). Three compact rows contain shape silhouettes, colors, then height stacks beside rotation and apply. Major outer insets are (28px); safe-area insets protect the header and bottom tray.

At widths of (700px) or less, the toolbar stays compact and the tray uses the viewport width minus (24px). Shape and color strips scroll horizontally, preserving targets of at least (44 × 44px). Height, rotation, and apply share the final row, with apply and rotation (48px) tall. Selected choices scroll into view. The tray is (182px) tall, leaving more of the world available for aiming.

At heights of (580px) or less in landscape orientation, the tray becomes a (310px) panel at the lower right. Camera controls move into a horizontal rail on the left; shape and color strips remain scrollable and height targets stay (44px) tall. At widths of (360px) or less, final-row spacing tightens while targets remain at least (44px) wide. The viewport itself does not scroll.

**The Reachable Palette Rule.** Preserve the established touch target sizes and horizontal overflow when adding palette choices; do not shrink choices to fit a narrow row.

**The Visual Control Rule.** Use concrete silhouettes and established action symbols in the normal building view. Preserve accessible names and hover titles. Put explanations in help, but keep actual errors readable. Symbols reduce the reading needed to play; do not assume every symbol is universally understood.

## Elevation & Depth

Opaque tonal layers, rounded edges, and one soft structural shadow separate tools from the GPU world. The shared panel shadow is `0 12px 38px #0005`; it appears on rails, the palette, help, toast, and the error panel. Selected shapes use a fine mint inset outline. Color swatches use a light inset boundary and selected outline plus checkmark. Avoid making these controls translucent: builds remain visible around them.

World depth comes from the overhead projection, directional face shading, contact shading, brick spacing, and luminous upper side rims. The analytic hex floor has crisp teal edges and a brighter board boundary. A translucent mint or red preview communicates placement validity. These effects are implemented directly in the renderer, without shipping raster textures or a postprocessing bloom dependency.

## Shapes

DOM controls use compact rounded rectangles: the control, icon, rail, and panel radius roles define the hierarchy. Material swatches are circles. Keep the hexagon motif in the actual board, brick silhouettes, and identity mark.

The eight shape icons derive from shared polygon outlines: Hexagon, Half, Rhombus, Wedge, Bullet, Bar, Corner, and Corner+. World geometry keeps the shared triangular lattice, six rotation steps of (60°), four height choices, and board dimensions of (96 × 64 metres). These geometry definitions remain authoritative in `src/hexbrick-core.ts` and `src/scene-config.ts`.

## Components

**Tool navigation and camera controls:** compact SVG icon buttons with accessible names and hover titles. Build uses a brick, paint a brush, removal an eraser, and centering a frame around a target. The help panel pairs the tool symbols with their names. Selection uses mint over a green charcoal fill; availability uses disabled styling and native button state.

**Palette:** shape tiles show the actual polygon; color buttons show a round material swatch; segmented height buttons show one to four stacked layers. Keep `aria-pressed` synchronized with visible selection. A selected swatch has both an outline and a checkmark, so color is not the sole state cue. Names and exact height multipliers are available through accessible labels and hover titles.

**Apply and Rotate:** the ruby apply button shows plus, brush, or eraser to match the current action; its accessible name changes with the icon. Rotation combines a circular arrow with degrees. Both are at least (48px) high. Apply remains disabled until an actionable target exists and briefly turns mint after success (180ms). Touch taps aim first; the apply button commits the edit. Camera gestures must preserve that distinction. Aim instructions remain available as an accessible description.

**Focus and interaction:** enabled controls shift down (1px) when pressed. Background and text transitions last (140ms) with `ease-out`; reduced-motion preference removes transitions. Buttons, links, and canvas have a visible mint focus outline (2px) with an offset of (4px); the canvas offset sits inside its boundary. Keyboard shortcuts preserve native Enter and Space activation for focused controls and links.

**Connection status:** a checked cloud means saved, an upward arrow means connecting or saving, and a crossed cloud means offline. A numeric badge shows queued edits. Status is never encoded by color alone. Tapping the cloud opens help explaining the symbols; hover titles and a live region provide the current status in words. Only show the checked cloud when the connection is live and no queued edits remain.

**Help and compatibility:** the world opens directly without an intro overlay. Help is available on demand and scrolls within the viewport. Routine undo, redo, and camera feedback uses symbols with accessible announcements; actual errors retain plain text. Compatibility errors explain the actual problem, offer retry, and link to the Decentraland scene.

## Do's and Don'ts

### Do:

- **Do** keep these rules scoped to `web/` and preserve the Decentraland scene's existing visual identity.
- **Do** derive brick colors, shapes, heights, and lattice placement from the shared definitions.
- **Do** keep the world visually dominant and controls opaque, compact, and reachable.
- **Do** preserve visible keyboard focus, native focused-control activation, and explicit touch placement.
- **Do** retain scrollable shape and color strips with at least 44 × 44px targets in mobile and compact landscape layouts.
- **Do** use native generated GPU geometry and authored SVG icons; the browser currently ships no raster assets.
- **Do** keep persistent controls visual, with words available through help, hover titles, and accessible names.

### Don't:

- **Don't** substitute a different renderer or camera concept for the chosen direct WebGPU overhead world without a new direction decision.
- **Don't** invent alternate browser material colors, brick silhouettes, or placement geometry.
- **Don't** let camera dragging or pinching commit an edit.
- **Don't** imply queued changes survive closing the page or represent browser guests as authenticated Decentraland accounts.
