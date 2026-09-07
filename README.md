# Hexabricks

A persistent cooperative building scene on a triangular lattice. Eight shapes,
eight colors, four heights, and a glowing six-by-four-parcel floor.

## Browser twin

Run `npm run web:start` and open `http://localhost:5173` for the native WebGPU
overhead builder, with touchscreen gestures and desktop controls. It connects
to the same live persistence server. `npm run web:build` creates the static
site in `dist/web/`; host it over HTTPS for phones. See [web/README.md](web/README.md)
for controls, isolated local testing, and browser requirements.

## Controls

- F: cycle Place → Delete → Paint; hold F to return to Place
- E or click: apply the current action
- 1: cycle legal placements ranked by shared edges
- 2: rotate
- 3: next shape
- 4: undo; Redo is in the HUD

The placement ghost holds the selected shape by its center. Delete shows the
target in red; Paint previews its new color. Remember rotation keeps one
orientation while placements change. Blocks may be 1x, 2x, 3x, or 4x high,
up to 21.6 metres. A placement that would trap the player moves them two
metres above it.

## Runtime

The scene emits ECS7 CRDT directly through the minimal runtime in `src/raw`.
There is no dcl-ecs scene build. Static brick entities in `main.crdt` are
generated directly from a persistence snapshot, together with the matching
`src/baked-bricks.ts` metadata table that the bundle hydrates on start.
`main.crdt` carries only renderer components, so explorers never parse
scene-only data. Models, textures, icons, and
the generated palette come from `scripts/gen-assets.ts`.

```bash
npm install
npm test
npm start
```

Use `npm start` for preview: it type-checks and builds the custom raw CRDT
entry before asking `dcl-one-sdk` to serve the existing bundle. A bare
`dcl-one-sdk start` selects its standard SDK-generated build instead.

Clients apply edits locally and synchronize deltas through
`wss://interconnected.online/hexabricks/ws`. Pending operations survive
reconnects and Lamport ordering resolves concurrent clients. Public building
is temporarily enabled; the invite graph remains available for restoring
permissions.

## Publish

Generate the cached first render from an atomic server snapshot, test it, then
build and deploy the raw bundle:

```bash
npm run gen-crdt -- /path/to/hexabricks.json
npm test
npm run build
dcl-one-sdk deploy --skip-build --dry-run --ci --yes \
  --entity-out /tmp/hexabricks-entity.json
npm run validate:snapshot -- \
  /path/to/hexabricks.json /tmp/hexabricks-entity.json
npm run deploy -- --target-server https://interconnected.online
```

`main.crdt` and `src/baked-bricks.ts` are the committed cached render and must
come from the same snapshot; the validator checks that. The deploy ignore list excludes
snapshots, backups, source, tests, and service data. Persistence service details
are in `service/README.md`.
