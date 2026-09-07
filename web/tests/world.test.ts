import assert from 'node:assert/strict'
import test from 'node:test'
import { World } from '../world.ts'
import { BrickWorld } from '../../service/world.ts'
import { Camera, add, scale } from '../camera.ts'
import { pick, placementTarget, brickGeometry } from '../geometry.ts'
import { elemsFor, triCentroid, HSUB } from '../../src/hexbrick-core.ts'
import { BRICK_BASE_Y, THICK_GAP } from '../../src/scene-config.ts'

const brick = { defIdx: 0, a0: 0, b0: 0, ys0: 0, rotK: 0, thick: 2, color: 0 }
function harness() {
  const messages: unknown[] = []
  const world = new World(() => {}, {
    lay: r => { messages.push(['lay', r]); return true }, paint: (id, color) => { messages.push(['paint', id, color]); return true }, breakBrick: id => { messages.push(['delete', id]); return true }
  }, 'web-test')
  return { world, messages }
}

test('every browser shape, rotation, and height is accepted by the unchanged persistence world', () => {
  for (let defIdx = 0; defIdx < 8; defIdx++) for (let rotK = 0; rotK < 6; rotK++) for (const thick of [2, 4, 6, 8]) {
    const { world } = harness(), server = new BrickWorld()
    const r = world.place({ ...brick, defIdx, rotK, thick })!
    assert.ok(r); assert.equal(server.add(r), true)
    assert.equal(world.place({ ...brick, defIdx, rotK, thick }), null, 'overlap must be rejected locally')
    const stacked = world.place({ ...brick, defIdx, rotK, thick, ys0: thick })!
    assert.ok(stacked); assert.equal(server.add(stacked), true)
  }
})

test('undo/redo restoration mints new IDs and keeps earlier paints linked to the restored brick', () => {
  const { world, messages } = harness()
  const r = world.place(brick)!
  world.paint(r.id, 6); world.delete(r.id)
  assert.equal(world.replay(false), null)
  const restored = [...world.records.values()][0]
  assert.notEqual(restored.id, r.id)
  assert.equal(restored.color, 6)
  assert.equal(world.replay(false), null); assert.equal(world.records.get(restored.id)?.color, 0)
  assert.equal(world.replay(false), null); assert.equal(world.records.size, 0)
  assert.equal(world.replay(true), null)
  const redone = [...world.records.values()][0]
  assert.notEqual(redone.id, restored.id)
  assert.equal(world.replay(true), null); assert.equal(world.records.get(redone.id)?.color, 6)
  assert.equal(world.replay(true), null); assert.equal(world.records.size, 0)
  assert.equal((messages.at(-1) as unknown[])[1], redone.id)
})

test('undo refuses to overwrite another builder’s paint and preserves the history entry', () => {
  const { world } = harness()
  const r = world.place(brick)!
  world.paint(r.id, 2); world.repaint(r.id, 7)
  assert.match(world.replay(false)!, /another builder/)
  assert.equal(world.records.get(r.id)?.color, 7)
  assert.equal(world.history.undoDepth(), 2)
})

test('authoritative reconnect replaces geometry, removes missing records and respects occupancy', () => {
  const { world } = harness()
  const r = world.place(brick)!
  world.snapshot([{ ...r, a0: 6, b0: 6 }])
  assert.equal(world.core.canPlace(0, 0, 0, 0, 0, 2), true)
  assert.equal(world.core.canPlace(0, 6, 6, 0, 0, 2), false)
  world.snapshot([]); assert.equal(world.records.size, 0)
})

test('native renderer mesh and picking cover every wedge for all shapes and rotations', () => {
  for (let defIdx = 0; defIdx < 8; defIdx++) {
    assert.ok([...brickGeometry(defIdx)].every(Number.isFinite))
    for (let rotK = 0; rotK < 6; rotK++) {
      const r = { ...brick, id: 1, by: 'test', at: 0, defIdx, rotK }
      for (const cell of elemsFor(defIdx, rotK, 0, 0)) {
        const p = triCentroid(cell.a, cell.b, cell.d)
        const hit = pick([p.x, 20, p.z], [0, -1, 0], [r])!
        assert.equal(hit.brick?.id, 1, `shape ${defIdx}, rotation ${rotK}, cell ${JSON.stringify(cell)}`)
        assert.ok(Math.abs(hit.point[1] - (BRICK_BASE_Y + r.thick * HSUB - THICK_GAP)) < 1e-6)
        assert.equal(placementTarget(hit, 2)?.ys, 2)
      }
    }
  }
})

test('orthographic screen rays round-trip through camera projection after pan, orbit and zoom', () => {
  const camera = new Camera(); camera.width = 390; camera.height = 844
  camera.pan(80, 40); camera.orbit(120, -35); camera.zoom(.7)
  const { origin, direction } = camera.ray(135, 256)
  const point = add(origin, scale(direction, 145)), screen = camera.project(point)
  assert.ok(Math.abs(screen[0] - 135) < 1e-8); assert.ok(Math.abs(screen[1] - 256) < 1e-8)
  assert.equal(pick([80, 20, 0], [0, -1, 0], []), null, 'outside floor must not be buildable')
})
