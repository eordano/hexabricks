# Hexabricks

## Platform

web

## Users and purpose

People collaboratively place, paint, and remove bricks in the same persistent world as the Decentraland scene. The browser twin must be enjoyable on desktop and touchscreens. It uses an overhead building camera and direct WebGPU rendering.

## Capabilities and constraints

Share the triangular lattice, eight shapes, eight colors, four heights, 96 × 64 metre floor, and WebSocket service with Decentraland. The browser is a standalone client; the existing scene remains runnable. Public building is currently enabled by the service. Browser identities are local guest identities, not authenticated Decentraland accounts. The browser is deployed at `https://interconnected.online/hexabricks/`.

## Evidence on hand

`src/hexbrick-core.ts`, `src/scene-config.ts`, `src/genesis-relay.ts`, and `scripts/gen-assets.ts` define geometry, rules, protocol, and incumbent colors. No invented builds should be uploaded as seed data.

## Accessibility and interaction

Large touch targets, explicit touch placement, camera gestures that cannot accidentally edit, keyboard controls, visible focus, reduced motion, and clear connection and compatibility states.

Minimize visible labels in the browser. Favor actual shapes, color swatches, layer stacks, recognizable action icons, and numbers so building requires little reading. Keep accessible names and on-demand explanations in help and hover titles; actual errors still explain recovery in words.
