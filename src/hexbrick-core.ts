
export interface PointXZ { x: number; z: number }
export interface TriCell { a: number; b: number; d: number }
interface ShapeCell { d: [number, number]; t: number }
interface Shape { name: string; color: number; cells: ShapeCell[] }
export interface Brick {
  id: number
  defIdx: number
  a0: number
  b0: number
  ys0: number
  rotK: number
  thick: number
}
export type Veto = (elems: TriCell[], ys0: number, thick: number) => boolean
export interface PlacementTarget { a: number; b: number; d: number; ys: number }
export interface PlacementOptions { sel: number; rot: number; thick: number; rememberRotation?: boolean }
export interface PlacementResult { a0: number; b0: number; rk: number; ok: boolean; grabbed: boolean; contacts: number }
interface World {
  occupied(a: number, b: number, d: number, ys: number): boolean
  canPlace(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number, veto?: Veto): boolean
  connected(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number): boolean
  contactEdges(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number): number
  restore(b: Brick): Brick | null
  remove(id: number): Brick | null
  resolvePlacement(t: PlacementTarget, o: PlacementOptions, veto?: Veto): PlacementResult | null
  size(): number
  get(id: number): Brick | undefined
}

export const S = 1
export const HSUB = 0.36
export const SQ3 = Math.sqrt(3)

export function center(q: number, r: number): PointXZ {
  return { x: S * SQ3 * (q + r / 2), z: S * 1.5 * r }
}
export function vert(k: number): PointXZ {
  const a = (-30 + 60 * k) * Math.PI / 180
  return { x: S * Math.cos(a), z: S * Math.sin(a) }
}
export function pointToCell(x: number, z: number): { q: number; r: number } {
  const rf = z / (1.5 * S), qf = x / (S * SQ3) - rf / 2
  let rq = Math.round(qf), rz = Math.round(rf)
  const ry = Math.round(-qf - rf)
  const dq = Math.abs(rq - qf), dz = Math.abs(rz - rf), dy = Math.abs(ry + qf + rf)
  if (dq > dz && dq > dy) rq = -rz - ry; else if (dz > dy) rz = -rq - ry
  return { q: rq, r: rz }
}

export function vertexPos(a: number, b: number): PointXZ {
  return { x: (a + b) * S * SQ3 / 2, z: (b - a) * S / 2 }
}
function latticeCoords(x: number, z: number): { al: number; be: number } {
  return { al: x / (S * SQ3) - z / S, be: x / (S * SQ3) + z / S }
}
export function triAt(x: number, z: number): TriCell {
  const { al, be } = latticeCoords(x, z)
  const a = Math.floor(al), b = Math.floor(be)
  return { a, b, d: al - a + (be - b) > 1 ? 1 : 0 }
}
export function triCentroid(a: number, b: number, d: number): PointXZ {
  return { x: (a + b) * S * SQ3 / 2 + (d + 1) * S * SQ3 / 3, z: (b - a) * S / 2 }
}
export function triCorners(a: number, b: number, d: number): PointXZ[] {
  return d === 0
    ? [vertexPos(a, b), vertexPos(a + 1, b), vertexPos(a, b + 1)]
    : [vertexPos(a + 1, b), vertexPos(a + 1, b + 1), vertexPos(a, b + 1)]
}
function rotVec(p: PointXZ, k: number): PointXZ {
  const a = (60 * k * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c }
}
function CELLS(d: [number, number], ts: number[]): ShapeCell[] {
  return ts.map((t) => ({ d, t }))
}
export const SHAPES: Shape[] = [
  { name: "hex",     color: 0xc0603f, cells: CELLS([0, 0], [0, 1, 2, 3, 4, 5]) },
  { name: "half",    color: 0xd79a3d, cells: CELLS([0, 0], [0, 1, 2]) },
  { name: "rhomb",   color: 0x6f9673, cells: CELLS([0, 0], [0, 1]) },
  { name: "wedge",   color: 0x5f7f9f, cells: CELLS([0, 0], [0]) },
  { name: "bullet",  color: 0x9a6f9e, cells: CELLS([0, 0], [0, 1, 2, 3]) },
  { name: "bar",     color: 0xa8574b,
    cells: CELLS([0, 0], [0, 1, 2]).concat(CELLS([0, 1], [3, 4, 5])) },
  { name: "corner",  color: 0x74a3a0,
    cells: CELLS([0, 0], [0, 1]).concat(CELLS([0, 1], [4, 5])) },
  { name: "corner+", color: 0xc2b25a,
    cells: CELLS([0, 0], [0, 1, 2]).concat(CELLS([0, 1], [2, 3, 4])) }
]

function wedgeCentroid(ref: ShapeCell): PointXZ {
  const c = center(ref.d[0], ref.d[1])
  const va = vert(ref.t), vb = vert(ref.t + 1)
  return { x: c.x + (va.x + vb.x) / 3, z: c.z + (va.z + vb.z) / 3 }
}
export const ELEMS: TriCell[][][] = SHAPES.map((shape) =>
  Array.from({ length: 6 }, (_, k) =>
    shape.cells.map((ref) => {
      const c = rotVec(wedgeCentroid(ref), k)
      return triAt(c.x, c.z)
    })
  )
)
export function elemsFor(defIdx: number, rotK: number, a0: number, b0: number): TriCell[] {
  return ELEMS[defIdx][rotK].map((c) => ({ a: c.a + a0, b: c.b + b0, d: c.d }))
}

export function triNeighbors(a: number, b: number, d: number): TriCell[] {
  return d === 0
    ? [{ a, b, d: 1 }, { a, b: b - 1, d: 1 }, { a: a - 1, b, d: 1 }]
    : [{ a, b, d: 0 }, { a: a + 1, b, d: 0 }, { a, b: b + 1, d: 0 }]
}

export function hexOf(a: number, b: number, d: number): { a: number; b: number } {
  const corners: Array<[number, number]> =
    d === 0
      ? [[a, b], [a + 1, b], [a, b + 1]]
      : [[a + 1, b], [a + 1, b + 1], [a, b + 1]]
  const c = corners.find(([x, y]) => vclass(x, y) === 0)!
  return { a: c[0], b: c[1] }
}

export function hexWedges(ca: number, cb: number): TriCell[] {
  return [
    { a: ca, b: cb, d: 0 },
    { a: ca - 1, b: cb, d: 0 },
    { a: ca, b: cb - 1, d: 0 },
    { a: ca - 1, b: cb, d: 1 },
    { a: ca - 1, b: cb - 1, d: 1 },
    { a: ca, b: cb - 1, d: 1 }
  ]
}

export function vclass(a: number, b: number): number {
  return (((a - b) % 3) + 3) % 3
}

export const ORDER: number[][][] = ELEMS.map((rots) =>
  rots.map((els) => {
    const cents = els.map((e) => triCentroid(e.a, e.b, e.d))
    let cx = 0
    let cz = 0
    for (const c of cents) {
      cx += c.x
      cz += c.z
    }
    cx /= cents.length
    cz /= cents.length
    return els
      .map((_, i) => i)
      .sort(
        (i, j) =>
          (cents[i].x - cx) ** 2 + (cents[i].z - cz) ** 2 -
          ((cents[j].x - cx) ** 2 + (cents[j].z - cz) ** 2)
      )
  })
)

export function outlinePts(defIdx: number, rotK: number): PointXZ[] {
  const PK = (p: PointXZ) => p.x.toFixed(4) + "," + p.z.toFixed(4)
  const edges = new Map<string, { a: PointXZ; b: PointXZ }>()
  elemsFor(defIdx, rotK, 0, 0).forEach((el) => {
    const cs = triCorners(el.a, el.b, el.d)
    for (let i = 0; i < 3; i++) {
      const e: [PointXZ, PointXZ] = [cs[i], cs[(i + 1) % 3]]
      const kr = PK(e[1]) + "|" + PK(e[0])
      if (edges.has(kr)) edges.delete(kr)
      else edges.set(PK(e[0]) + "|" + PK(e[1]), { a: e[0], b: e[1] })
    }
  })
  const byStart = new Map<string, { a: PointXZ; b: PointXZ }>()
  edges.forEach((e) => { byStart.set(PK(e.a), e) })
  const first = edges.values().next().value
  if (!first) return []
  const pts = [first.a]
  let cur: { a: PointXZ; b: PointXZ } | undefined = first
  for (let g = 0; g < 300; g++) {
    if (PK(cur.b) === PK(first.a)) break
    pts.push(cur.b)
    cur = byStart.get(PK(cur.b))
    if (!cur) break
  }
  if (pts.length !== edges.size)
    throw new Error(`outlinePts: footprint boundary is not a single closed loop (${pts.length}/${edges.size} edges)`)
  return pts
}

export function createWorld(opts?: { gridR?: number; halfWidth?: number; halfDepth?: number; maxSub?: number }): World {
  const gridR = opts?.gridR ?? 10
  const halfWidth = opts?.halfWidth
  const halfDepth = opts?.halfDepth
  const maxSub = opts?.maxSub ?? 30
  const coordLimit = halfWidth !== undefined && halfDepth !== undefined
    ? Math.ceil(halfWidth / (S * SQ3) + halfDepth / S) + 2
    : gridR * 2 + 3
  const coordSpan = coordLimit * 2 + 1
  const wordsPerColumn = Math.ceil(maxSub / 32)
  const occ = new Uint32Array(coordSpan * coordSpan * 2 * wordsPerColumn)
  function occupancyIndex(a: number, b: number, d: number, ys: number): number {
    const ai = a + coordLimit, bi = b + coordLimit
    if (ai < 0 || ai >= coordSpan || bi < 0 || bi >= coordSpan ||
        (d !== 0 && d !== 1) || ys < 0 || ys >= maxSub) return -1
    return (((ai * coordSpan + bi) * 2 + d) * wordsPerColumn) + (ys >>> 5)
  }
  function occupiedCell(a: number, b: number, d: number, ys: number): boolean {
    const i = occupancyIndex(a, b, d, ys)
    return i >= 0 && (occ[i] & (1 << (ys & 31))) !== 0
  }
  function setOccupied(a: number, b: number, d: number, ys: number, value: boolean): void {
    const i = occupancyIndex(a, b, d, ys)
    if (i < 0) throw new Error(`occupancy outside world: ${a},${b},${d},${ys}`)
    const mask = 1 << (ys & 31)
    if (value) occ[i] |= mask
    else occ[i] &= ~mask
  }
  const bricks = new Map<number, Brick>()

  function inBoard(a: number, b: number, d: number): boolean {
    if (halfWidth !== undefined && halfDepth !== undefined)
      return triCorners(a, b, d).every((p) =>
        Math.abs(p.x) <= halfWidth && Math.abs(p.z) <= halfDepth
      )
    const c = triCentroid(a, b, d)
    const cell = pointToCell(c.x, c.z)
    return (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2 <= gridR
  }

  function fits(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number): boolean {
    if (ys0 < 0 || ys0 + thick > maxSub) return false
    for (const el of elemsFor(defIdx, rotK, a0, b0)) {
      if (!inBoard(el.a, el.b, el.d)) return false
      for (let d = 0; d < thick; d++)
        if (occupiedCell(el.a, el.b, el.d, ys0 + d)) return false
    }
    return true
  }
  function connected(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number): boolean {
    if (ys0 === 0) return true
    for (const el of elemsFor(defIdx, rotK, a0, b0)) {
      if (occupiedCell(el.a, el.b, el.d, ys0 - 1) || occupiedCell(el.a, el.b, el.d, ys0 + thick)) return true
      for (const n of triNeighbors(el.a, el.b, el.d))
        for (let d = 0; d < thick; d++)
          if (occupiedCell(n.a, n.b, n.d, ys0 + d)) return true
    }
    return false
  }
  function canPlace(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number, veto?: Veto): boolean {
    if (vclass(a0, b0) !== 0) return false
    if (!fits(defIdx, a0, b0, ys0, rotK, thick)) return false
    if (veto && veto(elemsFor(defIdx, rotK, a0, b0), ys0, thick)) return false
    return connected(defIdx, a0, b0, ys0, rotK, thick)
  }

  function mark(b: Brick, value: boolean): void {
    for (const el of elemsFor(b.defIdx, b.rotK, b.a0, b.b0))
      for (let d = 0; d < b.thick; d++) setOccupied(el.a, el.b, el.d, b.ys0 + d, value)
  }

  function restore(b: Brick): Brick | null {
    if (bricks.has(b.id) || !fits(b.defIdx, b.a0, b.b0, b.ys0, b.rotK, b.thick)) return null
    const brick: Brick = { id: b.id, defIdx: b.defIdx, a0: b.a0, b0: b.b0, ys0: b.ys0, rotK: b.rotK, thick: b.thick }
    mark(brick, true)
    bricks.set(brick.id, brick)
    return brick
  }

  function remove(id: number): Brick | null {
    const b = bricks.get(id)
    if (!b) return null
    mark(b, false)
    bricks.delete(id)
    return b
  }

  function contactEdges(defIdx: number, a0: number, b0: number, ys0: number, rotK: number, thick: number): number {
    let score = 0
    for (const el of elemsFor(defIdx, rotK, a0, b0))
      for (const n of triNeighbors(el.a, el.b, el.d)) {
        for (let d = 0; d < thick; d++)
          if (occupiedCell(n.a, n.b, n.d, ys0 + d)) {
            score++
            break
          }
      }
    return score
  }

  function resolvePlacement(t: PlacementTarget, o: PlacementOptions, veto?: Veto): PlacementResult | null {
    const deltas = o.rememberRotation ? [0] : [0, 1, 5, 2, 4, 3]
    let ghostPick: { a0: number; b0: number; rk: number; grabbed: boolean } | null = null
    let best: {
      a0: number
      b0: number
      rk: number
      grabbed: boolean
      contacts: number
      rotationRank: number
      centerRank: number
    } | null = null
    const seen = new Set<string>()
    for (let rotationRank = 0; rotationRank < deltas.length; rotationRank++) {
      const rk = (o.rot + deltas[rotationRank]) % 6
      const els = ELEMS[o.sel][rk]
      let grabbed = true
      let centerRank = 0
      for (const i of ORDER[o.sel][rk]) {
        const e = els[i]
        if (e.d !== t.d || vclass(e.a, e.b) !== vclass(t.a, t.b)) continue
        const a0 = t.a - e.a, b0 = t.b - e.b
        const candidateKey = `${a0},${b0},${rk}`
        if (!seen.has(candidateKey) && canPlace(o.sel, a0, b0, t.ys, rk, o.thick, veto)) {
          seen.add(candidateKey)
          const candidate = {
            a0,
            b0,
            rk,
            grabbed,
            contacts: contactEdges(o.sel, a0, b0, t.ys, rk, o.thick),
            rotationRank,
            centerRank
          }
          if (
            !best ||
            candidate.contacts > best.contacts ||
            (candidate.contacts === best.contacts && candidate.rotationRank < best.rotationRank) ||
            (candidate.contacts === best.contacts && candidate.rotationRank === best.rotationRank && candidate.centerRank < best.centerRank)
          ) best = candidate
        }
        if (!ghostPick && fits(o.sel, a0, b0, t.ys, rk, o.thick)
            && !(veto && veto(elemsFor(o.sel, rk, a0, b0), t.ys, o.thick)))
          ghostPick = { a0, b0, rk, grabbed }
        grabbed = false
        centerRank++
      }
    }
    if (best) return { a0: best.a0, b0: best.b0, rk: best.rk, ok: true, grabbed: best.grabbed, contacts: best.contacts }
    if (ghostPick) return { ...ghostPick, ok: false, contacts: 0 }
    return null
  }

  return {
    occupied: occupiedCell,
    canPlace,
    connected,
    contactEdges,
    restore,
    remove,
    resolvePlacement,
    size: () => bricks.size,
    get: (id) => bricks.get(id)
  }
}
