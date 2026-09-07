const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const { createHarness } = require('./raw-harness.ts')
const golden = require('./fixtures/raw-interactions-golden.json')

let protocol
let harness

function codecsFor(p) {
  return new Map(p.BUILTIN_SPECS.map((entry) => [entry[1], entry[2]]))
}

function messages(chunks) {
  return chunks.flatMap((chunk) => protocol.parseCrdt(chunk))
}

function componentCounts(chunks) {
  const counts = {}
  for (const message of messages(chunks)) {
    if (message.component === undefined) continue
    counts[message.component] = (counts[message.component] ?? 0) + 1
  }
  return counts
}

function labels(h = harness) {
  return [...h.component(protocol.IDS.UiText).values()].map((item) => item.value)
}

const CRIMSON = [0.6392156863, 0.1490196078, 0.2196078431]

function deliverTo(h, entity, component, value, append = false) {
  return h.deliver(h.writeOne(entity, component, value, append))
}
const setPointerLock = (value, h = harness) => deliverTo(h, 2, protocol.IDS.PointerLock, { isPointerLocked: value })
function command(button, state = 1, h = harness) {
  const timestamp = h.nextEventTimestamp()
  // Global presses arrive on the root entity in every explorer.
  return deliverTo(h, 0, protocol.IDS.PointerEventsResult, {
    button, state, timestamp, tickNumber: timestamp, hit: undefined, analog: undefined
  }, true)
}
function pointAt(entity, position, h = harness) {
  return deliverTo(h, 2, protocol.IDS.RaycastResult, {
    timestamp: 1,
    globalOrigin: { x: position.x, y: position.y + 2, z: position.z },
    direction: { x: 0, y: -1, z: 0 },
    hits: [{ position, normalHit: { x: 0, y: 1, z: 0 }, length: 2, entityId: entity }],
    tickNumber: 1
  })
}
function pointAtTop(entity, h = harness) {
  const t = h.component(protocol.IDS.Transform).get(entity)
  return pointAt(entity, { x: t.position.x, y: t.position.y + t.scale.y / 2, z: t.position.z }, h)
}
function crimsonSwatch(h = harness) {
  const backgrounds = h.component(protocol.IDS.UiBackground)
  for (const entity of h.component(protocol.IDS.PointerEvents).keys()) {
    const color = backgrounds.get(entity)?.color
    if (color && CRIMSON.every((v, i) => Math.abs(color[['r', 'g', 'b'][i]] - v) < 1e-4)) return entity
  }
}
const undoLabel = (h = harness) => h.clickLabel(labels(h).find((value) => value.startsWith('Undo (')))
const submitInvite = (h = harness) => deliverTo(h, [...h.component(protocol.IDS.UiInput).keys()][0],
  protocol.IDS.UiInputResult, { value: 'nobody-nearby', isSubmit: true })

function modifierColor(entity) {
  return harness.component(protocol.IDS.GltfNodeModifiers).get(entity)
    ?.modifiers?.[0]?.material?.material?.pbr?.albedoColor
}

test.before(async () => {
  execFileSync(process.execPath, ['scripts/build-scene.ts'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'pipe'
  })
  protocol = await import('../src/raw/protocol.ts')
})

test.after(() => harness?.restore())

test('real generated snapshot is valid and hydration never reuses an entity id', async () => {
  const data = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../main.crdt')))
  const parsed = protocol.parseCrdt(data)
  const baked = await import('../src/baked-bricks.ts')
  const brickCount = baked.BAKED_BRICKS.length
  assert.ok(brickCount > 0)
  assert.equal(parsed.length, brickCount * 2)
  assert.deepEqual(componentCounts([data]), {
    [protocol.IDS.Transform]: brickCount,
    [protocol.IDS.GltfContainer]: brickCount
  })
  assert.equal(new Set(baked.BAKED_BRICKS.map((row) => row[0])).size, brickCount, 'baked brick ids are unique')
  const bakedEntities = new Set(parsed.map((message) => message.entity))
  baked.BAKED_BRICKS.forEach((row, index) => {
    assert.ok(bakedEntities.has(baked.BAKED_FIRST_ENTITY + index), `row ${index} has a baked entity`)
    assert.ok(row[8] in baked.BAKED_BY, `row ${index} names a builder`)
  })

  const { createRawEngine } = await import('../src/raw/engine.ts')
  const raw = createRawEngine()
  raw.beginFrame(0)
  raw.applyChunk(data, 'state')
  const hydratedIds = new Set(parsed.map((message) => message.entity))
  const allocated = raw.engine.addEntity()
  assert.equal(hydratedIds.has(allocated), false)
  assert.ok(allocated > Math.max(...[...hydratedIds].map((entity) => entity & 0xffff)))
  assert.equal(raw.componentEntries(protocol.IDS.GltfContainer).length, brickCount)
  assert.equal(raw.componentEntries(protocol.IDS.BrickData).length, 0, 'main.crdt carries no scene-only metadata')
})

test('CRDT parser accepts the Godot explorer delete-component header and stays aligned', () => {
  const words = (...values) => {
    const out = new Uint8Array(values.length * 4)
    new DataView(out.buffer).setUint32(0, values[0], true)
    values.forEach((value, index) => new DataView(out.buffer).setUint32(index * 4, value, true))
    return out
  }
  const godotDelete = words(28, protocol.DELETE_COMPONENT, 512, protocol.IDS.RaycastResult, 7)
  const unityDelete = words(20, protocol.DELETE_COMPONENT, 513, protocol.IDS.RaycastResult, 8)
  const deleteEntity = words(12, protocol.DELETE_ENTITY, 514)
  const chunk = new Uint8Array([...godotDelete, ...unityDelete, ...deleteEntity])
  const parsed = protocol.parseCrdt(chunk)
  assert.deepEqual(parsed.map((message) => [message.type, message.entity, message.length, message.offset]), [
    [protocol.DELETE_COMPONENT, 512, 20, 0],
    [protocol.DELETE_COMPONENT, 513, 20, 20],
    [protocol.DELETE_ENTITY, 514, 12, 40]
  ])
  assert.equal(parsed[0].component, protocol.IDS.RaycastResult)
  assert.equal(parsed[0].timestamp, 7)
  assert.deepEqual(protocol.parseCrdt(godotDelete).map((message) => message.entity), [512])
  assert.throws(() => protocol.parseCrdt(words(24, protocol.DELETE_COMPONENT, 512, 1, 0, 0)), /invalid delete-component length 24/)
})

test('CRDT parser rejects corruption and LWW components reject stale updates', async () => {
  assert.throws(() => protocol.parseCrdt(Uint8Array.of(24, 0, 0)), /truncated CRDT header/)
  const { createRawEngine } = await import('../src/raw/engine.ts')
  const raw = createRawEngine()
  const transform = codecsFor(protocol).get(protocol.IDS.Transform)
  const value = (x) => ({
    position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 }, parent: 0
  })
  const newer = new protocol.CrdtWriter()
  newer.put(42, protocol.IDS.Transform, 9, transform.encode(value(9)))
  const older = new protocol.CrdtWriter()
  older.put(42, protocol.IDS.Transform, 8, transform.encode(value(8)))
  raw.applyChunk(newer.take())
  raw.applyChunk(older.take())
  assert.equal(raw.getComponent(protocol.IDS.Transform).get(42).position.x, 9)
})

test('pointer commands are current-frame data and do not accumulate', async () => {
  const { createRawEngine } = await import('../src/raw/engine.ts')
  const raw = createRawEngine()
  const codec = codecsFor(protocol).get(protocol.IDS.PointerEventsResult)
  const entity = 42
  let notifications = 0
  raw.getComponent(protocol.IDS.PointerEventsResult).onChange(entity, () => notifications++)

  for (let timestamp = 1; timestamp <= 1000; timestamp++) {
    const writer = new protocol.CrdtWriter()
    writer.put(entity, protocol.IDS.PointerEventsResult, timestamp, codec.encode({
      button: 1, state: 1, timestamp, tickNumber: timestamp,
      hit: undefined, analog: undefined
    }), protocol.APPEND_VALUE)
    raw.beginFrame()
    raw.applyChunk(writer.take())
    assert.equal(raw.inputSystem.isTriggered(1, 1, entity), true)
  }

  assert.equal(notifications, 1000)
  assert.equal(raw.componentEntries(protocol.IDS.PointerEventsResult).length, 0)
  raw.beginFrame()
  assert.equal(raw.inputSystem.isTriggered(1, 1, entity), false)
  const empty = raw.flush()
  assert.equal(empty.byteLength, 0)
  assert.equal(raw.flush(), empty)
})

test('snapshot strings work without browser TextEncoder and TextDecoder globals', async () => {
  const NativeEncoder = global.TextEncoder
  const NativeDecoder = global.TextDecoder
  const sample = 'eordano.dcl.eth · 東京 · 🧱'
  const expected = new NativeEncoder().encode(sample)
  try {
    global.TextEncoder = undefined
    global.TextDecoder = undefined
    const codec = protocol.mapCodec({ value: { kind: 'string' } })
    const encoded = codec.encode({ value: sample })
    assert.deepEqual(encoded.subarray(4), expected)
    assert.equal(codec.decode(encoded).value, sample)

    const { createRawEngine } = await import('../src/raw/engine.ts')
    const raw = createRawEngine()
    const snapshot = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../main.crdt')))
    raw.applyChunk(snapshot, 'state')
    const brickCount = protocol.parseCrdt(snapshot)
      .filter((message) => message.component === protocol.IDS.GltfContainer).length
    assert.equal(raw.componentEntries(protocol.IDS.GltfContainer).length, brickCount)
  } finally {
    global.TextEncoder = NativeEncoder
    global.TextDecoder = NativeDecoder
  }
})

test('runtime defers output until the first update', async () => {
  harness = await createHarness()
  assert.equal(harness.sent.length, 0)
  await harness.tick()
  assert.ok(harness.sent.at(-1).byteLength > 0)
})

test('steady state sends no component work', async () => {
  await harness.tick()
  assert.equal(harness.sent.at(-1).byteLength, 0)
  for (let index = 0; index < 260; index++) await harness.tick()
  assert.equal(harness.sent.at(-1).byteLength, 0)
})

test('welcome appears only after four seconds in-parcel and dismisses by click', async () => {
  assert.equal(labels().includes('Start drawing'), false)
  harness.advance(3999)
  await harness.tick()
  assert.equal(labels().includes('Start drawing'), false)
  harness.advance(1)
  await harness.tick()
  assert.equal(labels().includes('Start drawing'), true)

  await setPointerLock(false)
  await harness.clickLabel('Start drawing')
  assert.equal(labels().includes('Start drawing'), false)
})

test('place, paint, undo, redo, delete, and restore preserve visual and metadata effects', async () => {
  const board = harness.entityWithGltf('models/board.glb')
  const ghost = harness.entityWithGltf('models/ghost-0.glb')
  assert.ok(board !== undefined)
  assert.ok(ghost !== undefined)

  await setPointerLock(false)
  await pointAt(board, { x: 48, y: 0.04, z: 32 })
  assert.ok(Math.abs(harness.component(protocol.IDS.Transform).get(ghost).scale.y - 0.675) < 1e-5)
  await harness.clickLabel('Place')
  assert.equal(harness.component(protocol.IDS.BrickData).size, 0, 'a UI tap must not place a brick')
  await command(0)

  assert.equal(harness.component(protocol.IDS.BrickData).size, 1)
  let brick = harness.entityWithGltf('models/brick-0-0.glb')
  assert.ok(brick !== undefined)
  assert.equal([...harness.component(protocol.IDS.BrickData).values()][0].color, 0)
  await harness.tick()
  assert.equal(harness.component(protocol.IDS.BrickData).size, 1, 'a pointer event must not replay')

  await setPointerLock(false)
  const crimson = crimsonSwatch()
  assert.ok(crimson !== undefined)
  await harness.clickEntity(crimson)
  await harness.clickLabel('Paint')
  await setPointerLock(false)
  await pointAtTop(brick)
  const paint = modifierColor(ghost)
  assert.ok(Math.abs(paint.r - CRIMSON[0]) < 1e-5)
  assert.ok(Math.abs(paint.g - CRIMSON[1]) < 1e-5)
  assert.ok(Math.abs(paint.a - 0.58) < 1e-5)
  await command(1)
  assert.equal(harness.component(protocol.IDS.GltfContainer).get(brick).src, 'models/brick-0-1.glb')
  const paintedMetadata = [...harness.component(protocol.IDS.BrickData).entries()]
  assert.equal(paintedMetadata.length, 1, `painted metadata: ${JSON.stringify(paintedMetadata)}`)
  assert.equal(paintedMetadata[0][1].color, 1)

  await setPointerLock(false)
  await undoLabel()
  assert.equal(harness.component(protocol.IDS.GltfContainer).get(brick).src, 'models/brick-0-0.glb')
  await harness.clickLabel('Redo')
  assert.equal(harness.component(protocol.IDS.GltfContainer).get(brick).src, 'models/brick-0-1.glb')

  await command(2, 1)
  await command(2, 0)
  await command(2, 1)
  await command(2, 0)
  await pointAtTop(brick)
  const deleting = modifierColor(ghost)
  assert.equal(deleting.r, 1)
  assert.ok(Math.abs(deleting.g - 0.12) < 1e-5)
  assert.ok(Math.abs(deleting.a - 0.58) < 1e-5)
  await command(1)
  assert.equal(harness.component(protocol.IDS.BrickData).size, 0)
  assert.equal(harness.component(protocol.IDS.GltfContainer).has(brick), false)

  await setPointerLock(false)
  await command(13)
  assert.equal(harness.component(protocol.IDS.BrickData).size, 1)
  brick = harness.entityWithGltf('models/brick-0-1.glb')
  assert.ok(brick !== undefined)
  assert.equal(harness.component(protocol.IDS.GltfContainer).get(brick).src, 'models/brick-0-1.glb')
  await harness.clickLabel('Redo')
  assert.equal(harness.component(protocol.IDS.BrickData).size, 0)
  await undoLabel()
  assert.equal(harness.component(protocol.IDS.BrickData).size, 1)
})

test('height, rotation memory, builder panel, and input submission are interactive', async () => {
  await setPointerLock(false)
  await harness.clickLabel('Place')
  await harness.clickLabel('4x')
  await harness.clickLabel('Remember rotation: Off')
  assert.equal(labels().includes('Remember rotation: On'), true)

  await setPointerLock(true)
  const board = harness.entityWithGltf('models/board.glb')
  await pointAt(board, { x: 60, y: 0.04, z: 32 })
  const ghost = harness.entityWithGltf('models/ghost-0.glb')
  assert.ok(Math.abs(harness.component(protocol.IDS.Transform).get(ghost).scale.y - 2.835) < 1e-5)

  await setPointerLock(false)
  await harness.clickLabel('<')
  assert.equal(labels().includes('Builders'), true)
  assert.equal(labels().includes('eordano.dcl.eth'), true)
  assert.ok(labels().some((value) => value.startsWith('  public build | ') && value.endsWith(' online')))

  await submitInvite()
  assert.equal(labels().includes('No known player named nobody-nearby; use their 0x address.'), true)
})

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  const result = {}
  for (const key of Object.keys(value).sort())
    if (value[key] !== undefined) result[key] = canonical(value[key])
  return result
}

function encoded(value) {
  return JSON.stringify(canonical(value))
}

function normalizedMessages(instance, start) {
  const result = []
  const batch = messages(instance.sent.slice(start))
  const reconciled = new Set([
    protocol.IDS.UiTransform,
    protocol.IDS.UiText,
    protocol.IDS.UiBackground,
    protocol.IDS.UiInput,
    protocol.IDS.PointerEvents
  ])
  const deleted = new Set(batch.filter((message) => message.type === protocol.DELETE_ENTITY)
    .map((message) => message.entity))
  for (const message of batch) {
    if (message.type === protocol.DELETE_COMPONENT && deleted.has(message.entity)) continue
    if (message.type === protocol.DELETE_ENTITY || reconciled.has(message.component)) continue
    let value = message.data
    const codec = instance.codecs.get(message.component)
    if (value && codec) value = codec.decode(value)
    if (message.component === protocol.IDS.UiTransform && value) {
      value = { ...value }
      delete value.parent
      delete value.rightOf
    }
    result.push(encoded({
      type: message.type,
      component: message.component,
      value: value instanceof Uint8Array ? [...value] : value
    }))
  }
  return result.sort()
}

function orderedUiChildren(ids, transforms) {
  const remaining = new Set(ids)
  const ordered = []
  let rightOf = 0
  while (remaining.size) {
    const next = [...remaining].find((entity) => (transforms.get(entity)?.rightOf ?? 0) === rightOf)
    if (next === undefined) break
    ordered.push(next)
    remaining.delete(next)
    rightOf = next
  }
  return ordered.concat([...remaining].sort((a, b) => a - b))
}

function uiFingerprint(instance) {
  const transforms = instance.component(protocol.IDS.UiTransform)
  const texts = instance.component(protocol.IDS.UiText)
  const backgrounds = instance.component(protocol.IDS.UiBackground)
  const inputs = instance.component(protocol.IDS.UiInput)
  const pointers = instance.component(protocol.IDS.PointerEvents)
  const byParent = new Map()
  for (const [entity, value] of transforms) {
    const parent = value.parent ?? 0
    const children = byParent.get(parent) ?? []
    children.push(entity)
    byParent.set(parent, children)
  }
  const seen = new Set()
  function node(entity) {
    if (seen.has(entity)) throw new Error(`cyclic UI tree at ${entity}`)
    seen.add(entity)
    const transform = { ...transforms.get(entity) }
    delete transform.parent
    delete transform.rightOf
    const result = canonical({
      transform,
      text: texts.get(entity),
      background: backgrounds.get(entity),
      input: inputs.get(entity),
      pointer: pointers.get(entity),
      children: orderedUiChildren(byParent.get(entity) ?? [], transforms).map(node)
    })
    seen.delete(entity)
    return result
  }
  return orderedUiChildren(byParent.get(0) ?? [], transforms).map(node)
}

function worldFingerprint(instance) {
  const transforms = instance.component(protocol.IDS.Transform)
  const gltfs = instance.component(protocol.IDS.GltfContainer)
  const modifiers = instance.component(protocol.IDS.GltfNodeModifiers)
  const visuals = [...gltfs].map(([entity, gltf]) => canonical({
    gltf,
    transform: transforms.get(entity),
    modifiers: modifiers.get(entity)
  })).sort((a, b) => encoded(a).localeCompare(encoded(b)))
  return canonical({ visuals, ui: uiFingerprint(instance), moves: instance.moves })
}

async function interactionReplay(create) {
  const instance = await create()
  const result = {}
  async function step(name, action) {
    const start = instance.sent.length
    await action()
    result[name] = {
      messages: normalizedMessages(instance, start),
      state: worldFingerprint(instance)
    }
  }
  const lock = (value) => setPointerLock(value, instance)

  await step('initial', () => instance.tick())
  instance.advance(4000)
  await step('welcome', () => instance.tick())
  await step('dismiss-welcome', () => instance.clickLabel('Start drawing'))
  await step('height', () => instance.clickLabel('4x'))
  await step('remember-rotation', () => instance.clickLabel('Remember rotation: Off'))
  await step('lock-for-place', () => lock(true))
  const board = instance.entityWithGltf('models/board.glb')
  await step('aim-place', () => pointAt(board, { x: 48, y: 0.04, z: 32 }, instance))
  await step('place', () => command(1, 1, instance))
  await step('unlock-for-paint', () => lock(false))
  await step('select-color', () => instance.clickEntity(crimsonSwatch(instance)))
  await step('select-paint', () => instance.clickLabel('Paint'))
  await step('lock-for-paint', () => lock(true))
  let brick = instance.entityWithGltf('models/brick-0-0.glb')
  await step('aim-paint', () => pointAtTop(brick, instance))
  await step('paint', () => command(1, 1, instance))
  await step('unlock-for-history', () => lock(false))
  await step('undo-paint', () => undoLabel(instance))
  await step('redo-paint', () => instance.clickLabel('Redo'))
  await step('select-delete', () => instance.clickLabel('Delete'))
  await step('lock-for-delete', () => lock(true))
  brick = instance.entityWithGltf('models/brick-0-1.glb')
  if (brick === undefined)
    throw new Error(`painted brick missing: ${JSON.stringify(
      {
        gltfs: [...instance.component(protocol.IDS.GltfContainer)]
          .filter(([, value]) => value.src.startsWith('models/brick-')),
        bricks: [...instance.component(protocol.IDS.BrickData)],
        ghost: instance.component(protocol.IDS.GltfNodeModifiers)
          .get(instance.entityWithGltf('models/ghost-0.glb'))
      }
    )}`)
  await step('aim-delete', () => pointAtTop(brick, instance))
  await step('delete', () => command(1, 1, instance))
  await step('unlock-after-delete', () => lock(false))
  await step('undo-delete', () => undoLabel(instance))
  await step('open-builders', () => instance.clickLabel('<'))
  await step('submit-invite', () => submitInvite(instance))
  instance.restore()
  return result
}

test('all supported interactions retain the verified SDK effects', async () => {
  harness?.restore()
  harness = undefined
  const raw = await interactionReplay(() => createHarness())
  const actual = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, {
    messages: createHash('sha256').update(encoded(value.messages)).digest('hex'),
    state: createHash('sha256').update(encoded(value.state)).digest('hex')
  }]))
  assert.deepEqual(actual, golden)
})

test('baked bricks hydrate metadata from the bundled table without sending it', async () => {
  const snapshot = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../main.crdt')))
  const baked = await import('../src/baked-bricks.ts')
  // A second harness re-requires the bundle, which replaces the shared harness's
  // globals; keep this last and hand them back when done.
  const shared = { raw: global.__HEXABRICKS_RAW__ }
  const local = await createHarness({ state: [snapshot] })
  try {
    await local.tick()
    const bricks = local.component(protocol.IDS.BrickData)
    assert.equal(bricks.size, baked.BAKED_BRICKS.length)
    baked.BAKED_BRICKS.forEach((row, index) => {
      const data = bricks.get(baked.BAKED_FIRST_ENTITY + index)
      assert.ok(data, `entity for row ${index}`)
      assert.deepEqual(
        [data.brickId, data.defIdx, data.a0, data.b0, data.ys0, data.rotK, data.color, data.thick, data.by, data.at],
        [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], baked.BAKED_BY[row[8]], row[9]]
      )
    })
    assert.equal(messages(local.sent).filter((message) => message.component === protocol.IDS.BrickData).length, 0)
  } finally {
    local.restore()
    global.__HEXABRICKS_RAW__ = shared.raw
  }
})
