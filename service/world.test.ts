import assert from 'node:assert/strict'
import test from 'node:test'
import { BrickWorld, clockWins, compareClock, decode, encode } from './world.ts'

const brick = (overrides = {}) => ({
  id: 1, defIdx: 3, a0: 0, b0: 0, ys0: 0, rotK: 0,
  color: 0, by: '0xabc', at: 1, thick: 2, ...overrides
})

test('round-trips the compact wire tuple', () => {
  assert.deepEqual(decode(encode(brick())), brick())
})

test('restores legacy tuples at the original height', () => {
  assert.equal(decode([1, 3, 0, 0, 0, 0, 0, '0xabc', 1]).thick, 2)
})

test('tall bricks occupy and validate their complete height', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick({ thick: 6 })), true)
  assert.equal(world.add(brick({ id: 2, ys0: 4 })), false)
  assert.equal(world.add(brick({ id: 3, ys0: 6 })), true)
})

test('accepts grounded work and rejects overlap', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick()), true)
  assert.equal(world.add(brick({ id: 2 })), false)
})

test('accepts placements across the parcel footprint, not only the central board', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick({ a0: 18, b0: 18 })), true)
  assert.equal(world.add(brick({ id: 2, a0: 30, b0: 30 })), false)
})

test('requires new elevated bricks to touch existing work', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick({ ys0: 2 })), false)
  assert.equal(world.add(brick()), true)
  assert.equal(world.add(brick({ id: 2, ys0: 2 })), true)
})

test('restores snapshots in arbitrary connectivity order', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick({ ys0: 2 }), true), true)
})

test('Lamport clocks order by counter, then actor for concurrent ties', () => {
  assert.equal(compareClock({ l: 8, k: 'z' }, { l: 9, k: 'a' }) < 0, true)
  assert.equal(compareClock({ l: 9, k: 'z' }, { l: 9, k: 'a' }) > 0, true)
  assert.equal(compareClock({ l: 9, k: 'a' }, { l: 9, k: 'a' }), 0)
})

test('all fake delivery orders converge to the same Lamport winner', () => {
  const operations = [
    { l: 12, k: 'alice', value: 'paint-red' },
    { l: 12, k: 'bob', value: 'delete' },
    { l: 11, k: 'zoe', value: 'paint-blue' }
  ]
  const permutations = (values) => values.length < 2
    ? [values]
    : values.flatMap((value, i) =>
      permutations([...values.slice(0, i), ...values.slice(i + 1)]).map((tail) => [value, ...tail]))

  for (const delivery of permutations(operations)) {
    let current
    let value
    for (const operation of delivery)
      if (clockWins(operation, current)) {
        current = operation
        value = operation.value
      }
    assert.equal(value, 'delete')
    assert.deepEqual({ l: current.l, k: current.k }, { l: 12, k: 'bob' })
  }
})
