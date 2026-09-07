const assert = require('node:assert/strict')
const test = require('node:test')
const { DirtyBrickMirror } = require('../src/brick-mirror.ts')

const brick = (overrides = {}) => ({
  id: 1, defIdx: 3, a0: 0, b0: 0, ys0: 0, rotK: 0,
  color: 0, by: '0xabc', at: 1, thick: 2, ...overrides
})

function harness() {
  const events = []
  const mirror = new DirtyBrickMirror({
    lay: (record, baked) => events.push(['lay', record.id, record.color, baked]),
    breakBrick: (id) => events.push(['break', id]),
    paint: (id, color) => events.push(['paint', id, color])
  })
  return { mirror, events }
}

test('golden mirror: adopts a baked entity and does no work while quiet', () => {
  const { mirror, events } = harness()
  mirror.bake(42, brick())
  assert.equal(mirror.flush(), 1)
  assert.deepEqual(events, [['lay', 1, 0, 42]])
  assert.equal(mirror.flush(), 0)
  assert.equal(mirror.pendingCount(), 0)
})

test('authoritative copy retains the baked visual and applies only color delta', () => {
  const { mirror, events } = harness()
  mirror.bake(42, brick())
  mirror.snapshot([brick()], [])
  mirror.flush()
  mirror.upsert(brick({ color: 6 }))
  mirror.flush()
  assert.deepEqual(events, [['lay', 1, 0, 42], ['paint', 1, 6]])
})

test('tombstone suppresses baked fallback and removes its rendered brick', () => {
  const { mirror, events } = harness()
  mirror.bake(42, brick())
  mirror.flush()
  mirror.snapshot([], [1])
  mirror.flush()
  assert.deepEqual(events, [['lay', 1, 0, 42], ['break', 1]])
  assert.deepEqual(mirror.seed(), [])
})

test('missing non-tombstoned server record falls back to disaster-recovery bake', () => {
  const { mirror, events } = harness()
  mirror.bake(42, brick())
  mirror.snapshot([], [])
  mirror.flush()
  assert.deepEqual(events, [['lay', 1, 0, 42]])
  assert.deepEqual(mirror.seed().map((x) => x.id), [1])
})

test('multiple repaint deltas coalesce to the final color before a flush', () => {
  const { mirror, events } = harness()
  mirror.upsert(brick())
  mirror.flush()
  mirror.repaint(1, 2)
  mirror.repaint(1, 7)
  assert.equal(mirror.pendingCount(), 1)
  mirror.flush()
  assert.deepEqual(events, [['lay', 1, 0, undefined], ['paint', 1, 7]])
})

test('a relay-only brick disappears when omitted by the next snapshot', () => {
  const { mirror, events } = harness()
  mirror.snapshot([brick()], [])
  mirror.flush()
  mirror.snapshot([], [])
  mirror.flush()
  assert.deepEqual(events, [['lay', 1, 0, undefined], ['break', 1]])
})
