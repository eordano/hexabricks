import assert from 'node:assert/strict'
import test from 'node:test'
import { BrickWorld } from './world.ts'

const brick = (overrides = {}) => ({
  id: 1, defIdx: 3, a0: 0, b0: 0, ys0: 28, rotK: 0,
  color: 0, by: '0xabc', at: 1, thick: 8, ...overrides
})

test('server column masks span word boundaries and clear on removal', () => {
  const world = new BrickWorld()
  assert.equal(world.add(brick(), true), true)
  const cell = { a: 0, b: 0, d: 0 }
  assert.equal(world.occupied(cell, 27), false)
  for (let y = 28; y < 36; y++) assert.equal(world.occupied(cell, y), true)
  assert.equal(world.occupied(cell, 36), false)
  assert.equal(world.add(brick({ id: 2, ys0: 34, thick: 2 }), true), false)
  assert.equal(world.remove(1), true)
  for (let y = 28; y < 36; y++) assert.equal(world.occupied(cell, y), false)
  assert.equal(world.add(brick({ id: 3 }), true), true)
})
