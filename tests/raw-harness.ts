const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')

const ADDRESS = '0xe7f78d2c9a9375153476834d2db32632384b01e1'

async function createHarness(options = {}) {
  const protocol = await import('../src/raw/protocol.ts')
  const codecs = new Map(protocol.BUILTIN_SPECS.map((entry) => [entry[1], entry[2]]))
  const state = new Map()
  const sent = []
  const responseQueue = []
  const moves = []
  let now = 1_000_000
  let eventTimestamp = 10

  function component(id) {
    let values = state.get(id)
    if (!values) state.set(id, values = new Map())
    return values
  }

  function apply(data) {
    for (const message of protocol.parseCrdt(data)) {
      if (message.type === protocol.DELETE_ENTITY) {
        for (const values of state.values()) values.delete(message.entity)
      } else if (message.type === protocol.DELETE_COMPONENT) {
        component(message.component).delete(message.entity)
      } else if (message.type === protocol.PUT_COMPONENT) {
        const codec = codecs.get(message.component)
        component(message.component).set(message.entity, codec ? codec.decode(message.data) : message.data)
      }
    }
  }

  function writeOne(entity, id, value, append = false) {
    const writer = new protocol.CrdtWriter()
    writer.put(entity, id, eventTimestamp++, codecs.get(id).encode(value), append ? protocol.APPEND_VALUE : protocol.PUT_COMPONENT)
    return writer.take()
  }

  const initial = new protocol.CrdtWriter()
  initial.put(1, protocol.IDS.Transform, 1, codecs.get(protocol.IDS.Transform).encode({
    position: { x: 10, y: 1, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    parent: 0
  }))
  initial.put(2, protocol.IDS.PointerLock, 1, codecs.get(protocol.IDS.PointerLock).encode({ isPointerLocked: true }))
  initial.put(0, protocol.IDS.UiCanvasInformation, 1, codecs.get(protocol.IDS.UiCanvasInformation).encode({
    devicePixelRatio: 1, width: 1920, height: 1080,
    interactableArea: undefined, screenInsetArea: undefined
  }))
  initial.put(2018, protocol.IDS.Transform, 1, codecs.get(protocol.IDS.Transform).encode({
    position: { x: 0, y: -100, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 0, y: 0, z: 0 },
    parent: 0
  }))
  const initialBytes = initial.take()
  const stateChunks = [initialBytes, ...(options.state ?? [])]
  for (const chunk of stateChunks) apply(chunk)

  const user = {
    userId: ADDRESS,
    name: 'eordano.dcl.eth',
    hasConnectedWeb3: true,
    avatar: { wearables: [], emotes: [] }
  }
  const mocks = {
    '~system/EngineApi': {
      crdtGetState: async () => ({ hasEntities: true, data: stateChunks }),
      crdtSendToRenderer: async ({ data }) => {
        sent.push(data)
        apply(data)
        return { data: responseQueue.shift() ?? [] }
      }
    },
    '~system/UserIdentity': { getUserData: async () => ({ data: user }) },
    '~system/Players': {
      getPlayersInScene: async () => ({ players: [] }),
      getPlayerData: async () => ({ data: undefined })
    },
    '~system/Runtime': { getRealm: async () => ({ realmInfo: { isPreview: true } }) },
    '~system/RestrictedActions': { movePlayerTo: async (value) => { moves.push(value) } }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    return mocks[request] ?? originalLoad.call(this, request, parent, isMain)
  }
  const originalNow = Date.now
  const originalRandom = Math.random
  const originalFetch = global.fetch
  const originalWebSocket = global.WebSocket
  Date.now = () => now
  Math.random = () => 0.5
  global.fetch = async () => ({ ok: false, json: async () => null })
  global.WebSocket = class {}
  const bundle = path.resolve(__dirname, '../bin/index.js')
  delete require.cache[bundle]
  const scene = require(bundle)
  await scene.onStart()

  async function tick(dt = 1 / 60) { await scene.onUpdate(dt) }
  async function deliver(data, dt = 1 / 60) {
    responseQueue.push([data])
    await tick(dt)
    await tick(dt)
    await tick(dt)
  }
  function entityWithGltf(src) {
    for (const [entity, value] of component(protocol.IDS.GltfContainer)) if (value.src === src) return entity
  }
  function clickableForLabel(label) {
    const texts = component(protocol.IDS.UiText)
    const transforms = component(protocol.IDS.UiTransform)
    const clickable = component(protocol.IDS.PointerEvents)
    let entity = [...texts].find(([, value]) => value.value === label)?.[0]
    while (entity !== undefined && entity !== 0) {
      if (clickable.has(entity)) return entity
      entity = transforms.get(entity)?.parent
    }
  }
  async function clickEntity(entity) {
    const timestamp = eventTimestamp++
    await deliver(writeOne(entity, protocol.IDS.PointerEventsResult, {
      button: 0, state: 1, timestamp, tickNumber: timestamp,
      hit: undefined, analog: undefined
    }, true))
  }
  async function clickLabel(label) {
    const entity = clickableForLabel(label)
    if (entity === undefined) throw new Error(`no clickable UI ancestor for label ${label}`)
    await clickEntity(entity)
  }
  const stateComponent = component

  return {
    protocol, codecs,
    component(id) {
      if (id === protocol.IDS.BrickData)
        return new Map(global.__HEXABRICKS_RAW__?.componentEntries(id) ?? [])
      return stateComponent(id)
    },
    state, sent, moves, tick, deliver, writeOne,
    entityWithGltf, clickableForLabel, clickEntity, clickLabel,
    nextEventTimestamp() { return eventTimestamp++ },
    advance(ms) { now += ms },
    restore() {
      Module._load = originalLoad
      Date.now = originalNow
      Math.random = originalRandom
      global.fetch = originalFetch
      global.WebSocket = originalWebSocket
      delete global.__HEXABRICKS_RAW__
    }
  }
}

module.exports = { ADDRESS, createHarness }
