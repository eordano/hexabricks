const assert = require('node:assert/strict')
const test = require('node:test')
const Core = require('../src/hexbrick-core.ts')

test('column masks preserve occupancy across the 32-bit word boundary', () => {
  const world = Core.createWorld({ halfWidth: 48, halfDepth: 32, maxSub: 60 })
  const record = { id: 7, defIdx: 3, a0: 0, b0: 0, ys0: 28, rotK: 0, thick: 8 }
  const brick = world.restore(record)
  assert.ok(brick)
  const cells = Core.elemsFor(record.defIdx, record.rotK, record.a0, record.b0)
  for (const cell of cells) {
    assert.equal(world.occupied(cell.a, cell.b, cell.d, 27), false)
    for (let y = 28; y < 36; y++) assert.equal(world.occupied(cell.a, cell.b, cell.d, y), true)
    assert.equal(world.occupied(cell.a, cell.b, cell.d, 36), false)
  }
  assert.equal(world.restore({ ...record, id: 8, ys0: 34, thick: 2 }), null)
})

test('removal clears every bit and permits an exact restoration', () => {
  const world = Core.createWorld({ gridR: 8, maxSub: 60 })
  const record = { id: 11, defIdx: 5, a0: 0, b0: 0, ys0: 30, rotK: 2, thick: 4 }
  assert.ok(world.restore(record))
  assert.equal(world.remove(record.id)?.id, record.id)
  for (const cell of Core.elemsFor(record.defIdx, record.rotK, record.a0, record.b0))
    for (let y = record.ys0; y < record.ys0 + record.thick; y++)
      assert.equal(world.occupied(cell.a, cell.b, cell.d, y), false)
  assert.ok(world.restore({ ...record, id: 12 }))
})
