const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const test = require('node:test')
const { createGenesisRelay } = require('../src/genesis-relay.ts')

const golden = JSON.parse(readFileSync(`${__dirname}/fixtures/persistence-golden.json`, 'utf8'))

function fromTuple(value) {
  return {
    id: value[0], defIdx: value[1], a0: value[2], b0: value[3], ys0: value[4],
    rotK: value[5], color: value[6], by: value[7], at: value[8], thick: value[9]
  }
}

class FakeSocket {
  static OPEN = 1
  static CLOSING = 2
  constructor() {
    this.readyState = 0
    this.sent = []
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  receive(value) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  send(raw) { this.sent.push(JSON.parse(raw)) }
}
global.WebSocket = FakeSocket

function harness(seedTuples = []) {
  const sockets = []
  const events = []
  const hooks = {
    address: () => '0xaaa',
    seed: () => seedTuples.map(fromTuple),
    snapshot: (records, deleted) => events.push(['snapshot', records.map((x) => [x.id, x.color]), deleted]),
    upsert: (rec) => events.push(['upsert', rec.id, rec.color]),
    remove: (id) => events.push(['remove', id]),
    repaint: (id, color) => events.push(['paint', id, color]),
    reject: (id) => events.push(['reject', id]),
    upsertBuilder: (entry) => events.push(['builder', entry.addr])
  }
  const relay = createGenesisRelay(hooks, {
    url: 'ws://test',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    }
  })
  return { relay, sockets, events }
}

test('golden: a clean join sends no redundant brick state', () => {
  const { sockets } = harness(golden.cleanJoin.baked)
  sockets[0].open()
  sockets[0].receive(golden.cleanJoin.snapshot)
  assert.deepEqual(sockets[0].sent.map((x) => x.t), golden.cleanJoin.outboundTags)
})

test('an old paint acknowledgement cannot clear a newer pending paint', () => {
  const { relay, sockets, events } = harness()
  sockets[0].open()
  sockets[0].receive({ t: 's', b: [[4, 3, 3, 3, 0, 0, 0, '0xddd', 40, 2]], d: [], i: [] })
  relay.paint(4, 2)
  const first = sockets[0].sent.at(-1)
  relay.paint(4, 7)
  const second = sockets[0].sent.at(-1)
  sockets[0].receive({ t: 'p', d: 4, c: 2, l: first.l, k: '0xaaa:test', o: first.o })
  sockets[0].close()
  relay.tick(2)
  sockets[1].open()
  sockets[1].receive({
    t: 's', b: [[4, 3, 3, 3, 0, 0, 2, '0xddd', 40, 2]], d: [], i: [],
    c: [[4, first.l, '0xaaa:test']], l: first.l
  })
  const replay = sockets[1].sent.find((x) => x.o === second.o)
  assert.equal(replay.c, 7)
  assert.deepEqual(events.at(-1), ['snapshot', [[4, 7]], []])
})

test('Lamport ordering ignores stale and lower-actor concurrent paint deltas', () => {
  const { sockets, events } = harness()
  sockets[0].open()
  sockets[0].receive({ t: 's', b: [[4, 3, 3, 3, 0, 0, 0, '0xddd', 40, 2]], d: [], i: [] })
  sockets[0].receive({ t: 'p', d: 4, c: 6, l: 10, k: 'z' })
  sockets[0].receive({ t: 'p', d: 4, c: 3, l: 9, k: 'z' })
  sockets[0].receive({ t: 'p', d: 4, c: 2, l: 10, k: 'a' })
  assert.deepEqual(events.filter((x) => x[0] === 'paint'), [['paint', 4, 6]])
})

test('golden: recovery offers only IDs missing from records and tombstones', () => {
  const { sockets } = harness(golden.storageRecovery.baked)
  sockets[0].open()
  sockets[0].receive(golden.storageRecovery.snapshot)
  const merge = sockets[0].sent.find((x) => x.t === 'm')
  assert.deepEqual(merge.b.map((x) => x[0]), golden.storageRecovery.recoveredIds)
})

test('golden: offline operations replay after the authoritative snapshot', () => {
  const { relay, sockets } = harness()
  relay.lay(fromTuple(golden.offlineJournal.lay))
  relay.paint(golden.offlineJournal.paint.id, golden.offlineJournal.paint.color)
  relay.breakBrick(golden.offlineJournal.delete)
  sockets[0].open()
  sockets[0].receive(golden.offlineJournal.snapshot)
  assert.deepEqual(sockets[0].sent.slice(1).map((x) => x.t), golden.offlineJournal.replayedTags)
})

test('acknowledged work is not replayed after reconnect', () => {
  const rec = fromTuple(golden.offlineJournal.lay)
  const { relay, sockets } = harness()
  sockets[0].open()
  sockets[0].receive({ t: 's', b: [], d: [], i: [] })
  relay.lay(rec)
  sockets[0].receive({ t: 'u', b: golden.offlineJournal.lay })
  sockets[0].close()
  relay.tick(2)
  sockets[1].open()
  sockets[1].receive({ t: 's', b: [golden.offlineJournal.lay], d: [], i: [] })
  assert.deepEqual(sockets[1].sent.map((x) => x.t), ['h'])
})

test('lost acknowledgement safely retries the same stable brick ID', () => {
  const rec = fromTuple(golden.offlineJournal.lay)
  const { relay, sockets } = harness()
  sockets[0].open()
  sockets[0].receive({ t: 's', b: [], d: [], i: [] })
  relay.lay(rec)
  sockets[0].close()
  relay.tick(2)
  sockets[1].open()
  sockets[1].receive({ t: 's', b: [], d: [], i: [] })
  assert.equal(sockets[1].sent.filter((x) => x.t === 'l').length, 1)
  assert.equal(sockets[1].sent.find((x) => x.t === 'l').b[0], rec.id)
})

test('canonical digest is independent of record and tombstone order', () => {
  const canonical = (records, deleted) => JSON.stringify({
    records: [...records].sort((a, b) => a[0] - b[0]),
    deleted: [...deleted].sort((a, b) => a - b)
  })
  const expected = golden.canonicalEdgeState
  const reversed = canonical([...expected.records].reverse(), [...expected.deleted].reverse())
  const normal = canonical(expected.records, expected.deleted)
  assert.equal(reversed, normal)
  assert.equal(createHash('sha256').update(reversed).digest('hex'), expected.sha256)
})

test('browser status tracks snapshot readiness and disposing prevents reconnection', () => {
  const statuses = [], sockets = []
  const relay = createGenesisRelay({
    address: () => 'web-test', seed: () => [], snapshot() {}, upsert() {}, remove() {},
    repaint() {}, reject() {}, upsertBuilder() {}
  }, {
    onStatus: value => statuses.push(value),
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket }
  })
  assert.deepEqual(statuses, ['connecting'])
  sockets[0].open()
  assert.deepEqual(statuses, ['connecting', 'syncing'])
  sockets[0].receive({ t: 's', b: [], d: [], l: 1 })
  assert.equal(statuses.at(-1), 'live')
  relay.paint(3, 2)
  assert.equal(relay.pendingCount(), 1)
  const op = sockets[0].sent.at(-1)
  sockets[0].receive({ t: 'n', d: 3, o: op.o })
  assert.equal(relay.pendingCount(), 0)
  sockets[0].close()
  assert.equal(statuses.at(-1), 'offline')
  relay.dispose(); relay.tick(60)
  assert.equal(sockets.length, 1)
})
