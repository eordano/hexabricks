import { BLOCK_HEIGHTS, FLOOR_D, FLOOR_W, MAX_SUB } from '../src/scene-config.ts'
import { decodeBrick, encodeBrick } from '../src/brick-wire.ts'
import { SHAPES, createWorld, vclass } from '../src/hexbrick-core.ts'

const THICKNESSES = new Set(BLOCK_HEIGHTS)

export function compareClock(a, b) {
  if (a.l !== b.l) return a.l - b.l
  return a.k < b.k ? -1 : a.k > b.k ? 1 : 0
}

export function clockWins(incoming, current) {
  return current === undefined || compareClock(incoming, current) > 0
}

export function validRecord(rec) {
  return rec &&
    ['id', 'defIdx', 'a0', 'b0', 'ys0', 'rotK', 'color', 'at', 'thick'].every((k) => Number.isSafeInteger(rec[k])) &&
    rec.id > 0 && rec.defIdx >= 0 && rec.defIdx < SHAPES.length &&
    rec.rotK >= 0 && rec.rotK < 6 && rec.color >= 0 && rec.color < 8 &&
    rec.ys0 >= 0 && rec.ys0 + rec.thick <= MAX_SUB && rec.ys0 % 2 === 0 && THICKNESSES.has(rec.thick) &&
    typeof rec.by === 'string' && rec.by.length <= 128
}

export class BrickWorld {
  records = new Map()
  lattice = createWorld({ halfWidth: FLOOR_W / 2, halfDepth: FLOOR_D / 2, maxSub: MAX_SUB })
  occupied(e, y) {
    return this.lattice.occupied(e.a, e.b, e.d, y)
  }
  add(rec, restoring = false) {
    if (!validRecord(rec) || this.records.has(rec.id) || vclass(rec.a0, rec.b0) !== 0) return false
    if (!restoring && !this.lattice.connected(rec.defIdx, rec.a0, rec.b0, rec.ys0, rec.rotK, rec.thick)) return false
    if (!this.lattice.restore(rec)) return false
    this.records.set(rec.id, rec)
    return true
  }
  remove(id) {
    if (!this.records.delete(id)) return false
    this.lattice.remove(id)
    return true
  }
}

export { encodeBrick as encode }
export function decode(value) {
  const record = decodeBrick(value)
  return validRecord(record) ? record : null
}
