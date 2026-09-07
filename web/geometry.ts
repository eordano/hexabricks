import { outlinePts, type PointXZ, vertexPos, HSUB, triAt, elemsFor, triNeighbors, triCentroid, triCorners, type PlacementTarget } from '../src/hexbrick-core.ts'
import { BRICK_BASE_Y, THICK_GAP, BOARD_LIFT, FLOOR_W, FLOOR_D } from '../src/scene-config.ts'
import type { BrickWireRecord } from '../src/brick-wire.ts'
import { add, sub, scale, cross, dot, type Vec3 } from './camera.ts'

// The same 0.035 m polygon inset used by the Decentraland asset generator.
export function inset(points: PointXZ[], distance = 0.035): PointXZ[] {
  const area = points.reduce((a, p, i) => a + p.x * points[(i + 1) % points.length].z - points[(i + 1) % points.length].x * p.z, 0)
  const sign = Math.sign(area)
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % points.length], dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz)
    return { x: p.x - sign * dz * distance / length, z: p.z + sign * dx * distance / length, dx, dz }
  })
  return lines.map((b, i) => {
    const a = lines[(i + lines.length - 1) % lines.length], det = a.dx * b.dz - a.dz * b.dx
    if (Math.abs(det) < 1e-9) return { x: b.x, z: b.z }
    const t = ((b.x - a.x) * b.dz - (b.z - a.z) * b.dx) / det
    return { x: a.x + a.dx * t, z: a.z + a.dz * t }
  }).filter((p, i, a) => {
    const prev = a[(i + a.length - 1) % a.length], next = a[(i + 1) % a.length]
    return Math.abs((p.x - prev.x) * (next.z - prev.z) - (p.z - prev.z) * (next.x - prev.x)) > 1e-9
  })
}

function triangulate(points: PointXZ[]): PointXZ[][] {
  const p = [...points]
  const area = p.reduce((sum, a, i) => sum + a.x * p[(i + 1) % p.length].z - a.z * p[(i + 1) % p.length].x, 0)
  if (area < 0) p.reverse()
  const edge = (a: PointXZ, b: PointXZ, c: PointXZ) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  const triangles: PointXZ[][] = []
  while (p.length > 3) {
    let found = false
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length]
      if (edge(a, b, c) <= 1e-9) continue
      if (p.some(q => q !== a && q !== b && q !== c && edge(a, b, q) > -1e-9 && edge(b, c, q) > -1e-9 && edge(c, a, q) > -1e-9)) continue
      triangles.push([a, b, c]); p.splice(i, 1); found = true; break
    }
    if (!found) throw new Error('Invalid brick polygon')
  }
  triangles.push(p)
  return triangles
}

export function brickGeometry(shape: number): Float32Array<ArrayBuffer> {
  const p = inset(outlinePts(shape, 0)), data: number[] = []
  const vertex = (p: PointXZ, y: number, normal: Vec3) => data.push(p.x, y, p.z, ...normal)
  for (const triangle of triangulate(p)) {
    for (const point of triangle) vertex(point, 1, [0, 1, 0])
    for (const point of triangle) vertex(point, 0, [0, -1, 0])
  }
  const sign = Math.sign(p.reduce((a, v, i) => a + v.x * p[(i + 1) % p.length].z - p[(i + 1) % p.length].x * v.z, 0))
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length], len = Math.hypot(b.x - a.x, b.z - a.z)
    const n: Vec3 = [sign * (b.z - a.z) / len, 0, -sign * (b.x - a.x) / len]
    vertex(a, 0, n); vertex(b, 0, n); vertex(b, 1, n)
    vertex(a, 0, n); vertex(b, 1, n); vertex(a, 1, n)
  })
  return new Float32Array(data)
}

const meshes = Array.from({ length: 8 }, (_, i) => brickGeometry(i))
export interface Hit { point: Vec3; normal: Vec3; brick?: BrickWireRecord; distance: number }
export function pick(origin: Vec3, direction: Vec3, records: Iterable<BrickWireRecord>): Hit | null {
  let best: Hit | null = null
  const floorT = (BOARD_LIFT - origin[1]) / direction[1]
  const floorPoint = add(origin, scale(direction, floorT))
  if (floorT > 0 && Math.abs(floorPoint[0]) <= FLOOR_W / 2 && Math.abs(floorPoint[2]) <= FLOOR_D / 2)
    best = { point: floorPoint, normal: [0, 1, 0], distance: floorT }
  for (const brick of records) {
    const anchor = vertexPos(brick.a0, brick.b0), height = brick.thick * HSUB - THICK_GAP
    const base = BRICK_BASE_Y + brick.ys0 * HSUB, angle = brick.rotK * Math.PI / 3, c = Math.cos(angle), s = Math.sin(angle)
    const relative = sub(origin, [anchor.x, base, anchor.z])
    const localOrigin: Vec3 = [relative[0] * c + relative[2] * s, relative[1] / height, -relative[0] * s + relative[2] * c]
    const localDir: Vec3 = [direction[0] * c + direction[2] * s, direction[1] / height, -direction[0] * s + direction[2] * c]
    // Cheap bounds test before the exact shared polygon triangles.
    let near = 0, far = best?.distance ?? Infinity
    for (let axis = 0; axis < 3; axis++) {
      const lo = axis === 1 ? 0 : -3, hi = axis === 1 ? 1 : 3
      if (Math.abs(localDir[axis]) < 1e-10) { if (localOrigin[axis] < lo || localOrigin[axis] > hi) far = -1; continue }
      const a = (lo - localOrigin[axis]) / localDir[axis], b = (hi - localOrigin[axis]) / localDir[axis]
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b))
    }
    if (far < near) continue
    const mesh = meshes[brick.defIdx]
    for (let i = 0; i < mesh.length; i += 18) {
      const a: Vec3 = [mesh[i], mesh[i + 1], mesh[i + 2]], b: Vec3 = [mesh[i + 6], mesh[i + 7], mesh[i + 8]], d: Vec3 = [mesh[i + 12], mesh[i + 13], mesh[i + 14]]
      const e1 = sub(b, a), e2 = sub(d, a), h = cross(localDir, e2), det = dot(e1, h)
      if (Math.abs(det) < 1e-9) continue
      const delta = sub(localOrigin, a), u = dot(delta, h) / det
      if (u < 0 || u > 1) continue
      const q = cross(delta, e1), v = dot(localDir, q) / det
      if (v < 0 || u + v > 1) continue
      const t = dot(e2, q) / det
      if (t < 0 || (best && t >= best.distance)) continue
      best = { distance: t, point: add(origin, scale(direction, t)), normal: [mesh[i + 3] * c - mesh[i + 5] * s, mesh[i + 4], mesh[i + 3] * s + mesh[i + 5] * c], brick }
    }
  }
  return best
}

export function placementTarget(hit: Hit, thickness: number): PlacementTarget | null {
  const [x, , z] = hit.point, [nx, ny, nz] = hit.normal, b = hit.brick
  if (!b) return { ...triAt(x, z), ys: 0 }
  const mine = new Set(elemsFor(b.defIdx, b.rotK, b.a0, b.b0).map(e => `${e.a},${e.b},${e.d}`))
  if (ny > 0.5) {
    const cell = triAt(x, z), corners = triCorners(cell.a, cell.b, cell.d)
    let rim: PlacementTarget | null = null, distance = 0.25
    for (const n of triNeighbors(cell.a, cell.b, cell.d)) {
      if (mine.has(`${n.a},${n.b},${n.d}`)) continue
      const shared = triCorners(n.a, n.b, n.d).filter(p => corners.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 1e-6))
      if (shared.length !== 2) continue
      const [a, b] = shared, dx = b.x - a.x, dz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)))
      const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz)
      if (d < distance) { distance = d; rim = { ...n, ys: hit.brick!.ys0 } }
    }
    return rim ?? { ...triAt(x, z), ys: b.ys0 + b.thick }
  }
  if (ny < -0.5) return b.ys0 < thickness ? null : { ...triAt(x, z), ys: b.ys0 - thickness }
  const inside = triAt(x - nx * 0.05, z - nz * 0.05), c = triCentroid(inside.a, inside.b, inside.d)
  const neighbors = triNeighbors(inside.a, inside.b, inside.d).filter(n => !mine.has(`${n.a},${n.b},${n.d}`))
  neighbors.sort((a, b) => {
    const aa = triCentroid(a.a, a.b, a.d), bb = triCentroid(b.a, b.b, b.d)
    return (bb.x - c.x) * nx + (bb.z - c.z) * nz - ((aa.x - c.x) * nx + (aa.z - c.z) * nz)
  })
  return neighbors[0] ? { ...neighbors[0], ys: b.ys0 } : null
}
