# Hexabricks browser twin

An overhead building client rendered directly with WebGPU and WGSL. There are no runtime libraries, Three.js, or separate game server. It shares the scene's lattice engine, dimensions, material palette, wire encoding, and reconnecting WebSocket client.

Live: **https://interconnected.online/hexabricks/**.

```bash
npm install
npm run web:start
```

Open **http://localhost:5173**. By default this connects to the same live world as Decentraland at `wss://interconnected.online/hexabricks/ws`. Edits affect that shared world. The browser uses a persistent local guest identifier; it does not impersonate a wallet. This matches the service's current open-build policy.

## Controls

The building view uses symbols: brick / brush / eraser for tools, actual silhouettes for shapes, color swatches, and one to four visible layers for height. The apply icon changes with the selected tool. Hover for names and shortcuts, or tap **?** for help. Screen readers retain descriptive control names and status announcements.

| Action | Touch | Desktop |
| --- | --- | --- |
| Aim / place | Tap a spot, then the plus button | Hover to preview, click or E to place |
| Pan | One-finger drag | Left-drag, or WASD |
| Zoom | Pinch or + / − buttons | Wheel or + / − keys |
| Orbit | Turn on Orbit, then drag | Right-drag or Alt-drag |
| Rotate brick | Rotate button | R or 2 |
| Change tool | Build / Paint / Remove | B / P / X, or cycle with F |
| Next shape / alternate placement | Shape palette | 3 / 1 |
| Undo / redo | Toolbar buttons | Ctrl/⌘ Z / Ctrl/⌘ Shift Z |
| Aim without a mouse | — | Arrow keys, then E |

Aim at the middle of a brick's top to stack, or its rim/side to build beside it. Shapes, colors and heights match Decentraland. Undoing a deletion uses a new ID because the persistence server retains tombstones. Undo refuses to overwrite a conflicting remote paint.

## Local service and tests

Run the existing service with a **separate test data file**, then pass its WebSocket URL:

```bash
HEXABRICKS_DATA_FILE=/tmp/hexabricks-web-dev.json npm run service:start
```

Open `http://localhost:5173/?server=ws://127.0.0.1:8787/hexabricks/ws`.

```bash
npm run web:build
npm run web:test
npm run web:test:browser
npm test
```

Browser tests start an isolated persistence service in a temporary directory. They exercise native WebGPU initialization, two-client edits, undo/redo, reconnect replay, touch gestures, keyboard input, responsive bounds, and unsupported browsers. `CHROMIUM_PATH` selects a local Chromium executable; otherwise an installed Chromium or Playwright's downloaded browser is used. On this Nix Linux environment the test configuration selects Mesa's software Vulkan driver. These automated touch checks emulate a phone; physical iOS/Android testing remains useful before a public launch.

## Build and host

`npm run web:build` produces static files in `dist/web/`. Serve that directory over **HTTPS** at any path. Asset links are relative and the live socket URL is independent of the hosting origin. No server changes are required. Keep `/hexabricks/ws` routed to the existing service if serving the browser under the same domain. The existing service itself does not serve these static files.

On `interconnected`, nginx serves `/hexabricks/` from `/srv/hexabricks`, an atomic symlink to a versioned directory under `/srv/hexabricks-releases/`. `/hexabricks` redirects to the trailing slash and preserves query parameters. Exact `/hexabricks/ws` and `/hexabricks/health` routes retain the existing persistence service. Static assets require cache revalidation.

The managed hosting configuration is `/persist/colmena/hosts/decent/interconnected/hexabricks.nix`, generated from `docs/hosts/decent/interconnected.org` in that infrastructure repository. For subsequent browser releases, build and verify `dist/web/`, upload it into a new release directory, and atomically replace `/srv/hexabricks`. Asset updates do not require restarting nginx or the persistence service. Each release includes a `release.json` manifest with file checksums.

WebGPU requires a supporting browser, device and secure context. `localhost` works for development; a plain HTTP LAN address does not provide WebGPU on a phone. Use an HTTPS development proxy or HTTPS static hosting for physical-device testing. Unsupported adapters, initialization failures and device loss show recovery instructions.

Edits are optimistic and queue during disconnection for the lifetime of the page. Wait for the **checked cloud** before closing; hover for the current status or tap for help explaining the symbols. An arrow means connecting or saving, a crossed cloud means offline, and the badge counts queued edits. Pending operations are not persisted across a page reload. The browser never submits cached snapshots or example content as recovery seed data. Rendering is scheduled on changes, with eight instanced brick batches, bounded pixel density, and no continuous idle loop.
