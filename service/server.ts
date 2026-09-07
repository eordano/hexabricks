import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { appendJournal, loadJournal, replaceJournal } from './journal.ts'
import { loadSnapshot, writeSnapshot } from './snapshot.ts'
import { clockWins, decode, encode } from './world.ts'
import { INITIAL_BUILDERS } from '../src/access-config.ts'

const HOST = process.env.HEXABRICKS_HOST || '127.0.0.1'
const PORT = Number(process.env.HEXABRICKS_PORT || 8787)
const DATA_FILE = resolve(process.env.HEXABRICKS_DATA_FILE || './data/hexabricks.json')
const JOURNAL_FILE = resolve(process.env.HEXABRICKS_JOURNAL_FILE || `${DATA_FILE}.journal`)
const SNAPSHOT_EVERY_OPS = Number(process.env.HEXABRICKS_SNAPSHOT_EVERY_OPS || 100)
const SNAPSHOT_INTERVAL_MS = Number(process.env.HEXABRICKS_SNAPSHOT_INTERVAL_MS || 60_000)
if (!Number.isSafeInteger(SNAPSHOT_EVERY_OPS) || SNAPSHOT_EVERY_OPS < 1 ||
    !Number.isSafeInteger(SNAPSHOT_INTERVAL_MS) || SNAPSHOT_INTERVAL_MS < 1)
  throw new Error('snapshot cadence must use positive integers')
const WS_PATH = '/hexabricks/ws'
const MAX_BUFFERED = 512 * 1024

const restored = await loadSnapshot(DATA_FILE, INITIAL_BUILDERS)
const loadedSnapshotRevision = restored.revision
const recovered = await loadJournal(JOURNAL_FILE, restored)
const world = restored.world
const deleted = restored.deleted
const clocks = restored.clocks
const builders = restored.builders
let revision = restored.revision
let lamport = restored.lamport
let snapshotRevision = loadedSnapshotRevision
let journalEntries = recovered.entries
let rotateCurrentSnapshot = restored.source !== `${DATA_FILE}.prev`
let lastSnapshotAt = Date.now()

if (restored.source)
  console.log(`restored ${world.records.size} bricks at revision ${revision} from ${restored.source}`)
else
  console.log(`starting from journal with ${world.records.size} bricks at revision ${revision}`)
if (recovered.applied)
  console.log(`replayed ${recovered.applied} durable operations from ${JOURNAL_FILE}`)

function snapshotState() {
  return {
    version: 2,
    revision,
    bricks: [...world.records.values()].map(encode),
    deleted: [...deleted],
    builders: [...builders.values()],
    clocks: [...clocks].map(([id, clock]) => [id, clock.l, clock.k])
  }
}

async function compactSnapshot(force = false) {
  const due = revision - snapshotRevision >= SNAPSHOT_EVERY_OPS ||
    Date.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
  if (!force && !due) return
  if (revision === snapshotRevision && rotateCurrentSnapshot) return
  const previousSnapshotRevision = snapshotRevision
  await writeSnapshot(DATA_FILE, snapshotState(), { rotateCurrent: rotateCurrentSnapshot })
  const retained = journalEntries.filter((entry) => entry.r > previousSnapshotRevision)
  await replaceJournal(JOURNAL_FILE, retained)
  journalEntries = retained
  snapshotRevision = revision
  rotateCurrentSnapshot = true
  lastSnapshotAt = Date.now()
}

async function persist(entry) {
  await appendJournal(JOURNAL_FILE, entry)
  journalEntries.push(entry)
  await compactSnapshot()
}

const server = createServer((req, res) => {
  const json = (value) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  if (req.method !== 'GET') return res.writeHead(404).end()
  if (req.url === '/hexabricks/health')
    return json({ ok: true, revision, bricks: world.records.size, builders: builders.size, peers: wss.clients.size })
  if (req.url === '/hexabricks' || req.url === '/hexabricks/')
    return json({ service: 'hexabricks-genesis-peer', websocket: WS_PATH, revision })
  res.writeHead(404).end()
})
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: { threshold: 1024 } })

function safeSend(peer, value) {
  if (peer.readyState !== WebSocket.OPEN) return
  if (peer.bufferedAmount > MAX_BUFFERED) return peer.terminate()
  peer.send(JSON.stringify(value))
}
function broadcast(value) {
  for (const peer of wss.clients) safeSend(peer, value)
}
function snapshot(peer) {
  safeSend(peer, {
    t: 's', r: revision,
    b: [...world.records.values()].map(encode),
    d: [...deleted],
    i: [...builders.values()].map(encodeBuilder),
    c: [...clocks].map(([id, clock]) => [id, clock.l, clock.k]),
    l: lamport
  })
}
function encodeBuilder(entry) {
  return [entry.addr, entry.name, entry.invitedBy, entry.at]
}
function incomingClock(peer, msg) {
  const value = msg.l === undefined ? lamport + 1 : msg.l
  if (!Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) return null
  lamport = Math.max(lamport, value)
  return { l: value, k: peer.actor }
}
const clockOf = (id) => clocks.get(id) ?? { l: 0, k: '' }
function clockFields(id, op) {
  const clock = clockOf(id)
  return { l: clock.l, k: clock.k, ...(typeof op === 'string' ? { o: op } : {}) }
}
function replyCurrent(peer, id, op) {
  const rec = world.records.get(id)
  if (rec) safeSend(peer, { t: 'u', r: revision, b: encode(rec), ...clockFields(id, op) })
  else if (deleted.has(id)) safeSend(peer, { t: 'x', r: revision, d: id, ...clockFields(id, op) })
  else safeSend(peer, { t: 'n', r: revision, d: id, o: op, l: lamport })
}
async function mutateAdd(peer, rec, msg, restoring = false) {
  const incoming = incomingClock(peer, msg)
  if (!incoming) return false
  if (deleted.has(rec.id)) {
    replyCurrent(peer, rec.id, msg.o)
    return false
  }
  const old = world.records.get(rec.id)
  if (old) {
    replyCurrent(peer, rec.id, msg.o)
    return true
  }
  if (!world.add(rec, restoring)) {
    safeSend(peer, { t: 'n', r: revision, d: rec.id, o: msg.o, l: lamport })
    return false
  }
  clocks.set(rec.id, incoming)
  revision++
  await persist({ v: 1, r: revision, op: 'u', b: encode(rec), l: incoming.l, k: incoming.k })
  broadcast({ t: 'u', r: revision, b: encode(rec), ...clockFields(rec.id, msg.o) })
  return true
}

async function mutatePaint(peer, id, color, msg) {
  const incoming = incomingClock(peer, msg)
  if (!incoming) return false
  const rec = world.records.get(id)
  if (!rec || !Number.isSafeInteger(color) || color < 0 || color >= 8) {
    replyCurrent(peer, id, msg.o)
    return false
  }
  if (!clockWins(incoming, clockOf(id))) {
    replyCurrent(peer, id, msg.o)
    return false
  }
  if (rec.color !== color) world.records.set(id, { ...rec, color })
  clocks.set(id, incoming)
  revision++
  await persist({ v: 1, r: revision, op: 'p', id, color, l: incoming.l, k: incoming.k })
  broadcast({ t: 'p', r: revision, d: id, c: color, ...clockFields(id, msg.o) })
  return true
}

async function mutateDelete(peer, id, msg) {
  const incoming = incomingClock(peer, msg)
  if (!incoming) return false
  if ((world.records.has(id) || deleted.has(id)) && !clockWins(incoming, clockOf(id))) {
    replyCurrent(peer, id, msg.o)
    return false
  }
  world.remove(id)
  deleted.add(id)
  clocks.set(id, incoming)
  revision++
  await persist({ v: 1, r: revision, op: 'x', id, l: incoming.l, k: incoming.k })
  broadcast({ t: 'x', r: revision, d: id, ...clockFields(id, msg.o) })
  return true
}

let mutationChain = Promise.resolve()
let shuttingDown = false
function enqueueMutation(fn) {
  if (shuttingDown) return
  mutationChain = mutationChain.then(fn).catch((error) => {
    console.error('fatal durable mutation failure', error)
    shuttingDown = true
    server.close()
    for (const peer of wss.clients) peer.terminate()
    setTimeout(() => process.exit(1), 0)
  })
}

wss.on('connection', (peer) => {
  peer.isAlive = true
  peer.address = ''
  peer.windowAt = Date.now()
  peer.messages = 0
  peer.on('pong', () => { peer.isAlive = true })
  peer.on('message', (raw, binary) => {
    if (binary || raw.length > 1024 * 1024) return peer.close(1003, 'text messages only')
    const now = Date.now()
    if (now - peer.windowAt >= 1000) {
      peer.windowAt = now
      peer.messages = 0
    }
    if (++peer.messages > 30) return peer.close(1008, 'rate limit')
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.t === 'h') {
      if (msg.v !== 1 || typeof msg.a !== 'string' || msg.a.length > 128) return peer.close(1002, 'protocol')
      peer.address = msg.a.toLowerCase()
      const session = typeof msg.s === 'string' && /^[a-z0-9-]{1,48}$/i.test(msg.s)
        ? msg.s : `legacy-${Math.random().toString(36).slice(2, 10)}`
      peer.actor = session
      snapshot(peer)
      return
    }
    if (!peer.address) return peer.close(1008, 'hello required')
    if (msg.o !== undefined && (typeof msg.o !== 'string' || msg.o.length > 64)) return
    if (msg.t === 'l') {
      const input = decode(msg.b)
      if (!input) return
      enqueueMutation(() => mutateAdd(peer, { ...input, by: peer.address, at: now }, msg))
      return
    }
    if (msg.t === 'd' && Number.isSafeInteger(msg.d)) {
      enqueueMutation(() => mutateDelete(peer, msg.d, msg))
      return
    }
    if (msg.t === 'p' && Number.isSafeInteger(msg.d) && Number.isSafeInteger(msg.c)) {
      enqueueMutation(() => mutatePaint(peer, msg.d, msg.c, msg))
      return
    }
    if (msg.t === 'm' && Array.isArray(msg.b) && msg.b.length <= 5000) {
      enqueueMutation(async () => {
        for (const value of msg.b) {
          const rec = decode(value)
          if (rec && !world.records.has(rec.id) && !deleted.has(rec.id))
            await mutateAdd(peer, rec, { l: lamport + 1 }, true)
        }
      })
    }
  })
})

server.on('upgrade', (req, socket, head) => {
  if (req.url !== WS_PATH) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (peer) => wss.emit('connection', peer, req))
})

const heartbeat = setInterval(() => {
  for (const peer of wss.clients) {
    if (!peer.isAlive) {
      peer.terminate()
      continue
    }
    peer.isAlive = false
    peer.ping()
  }
}, 30_000)

const snapshotTimer = setInterval(
  () => enqueueMutation(() => compactSnapshot()),
  Math.min(SNAPSHOT_INTERVAL_MS, 10_000)
)

server.listen(PORT, HOST, () => console.log(`hexabricks peer listening on http://${HOST}:${PORT}`))

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(heartbeat)
  clearInterval(snapshotTimer)
  server.close()
  for (const peer of wss.clients) peer.close(1001, 'shutdown')
  const deadline = setTimeout(() => process.exit(1), 5000)
  deadline.unref()
  try {
    await mutationChain
    await compactSnapshot(true)
    clearTimeout(deadline)
    process.exit(0)
  } catch (error) {
    console.error('shutdown persistence failed', error)
    process.exit(1)
  }
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
