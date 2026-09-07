import {
  ColliderLayer,
  GltfContainer,
  GltfNodeModifiers,
  InputAction,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  RaycastQueryType,
  TextureWrapMode,
  Transform,
  engine,
  inputSystem,
  raycastSystem
} from './raw/shims/ecs.ts'
import { Color3, Color4, Quaternion, Vector3 } from './raw/shims/math.ts'
import {
  BLOCK_HEIGHTS,
  BOARD_LIFT,
  FLOOR_D,
  FLOOR_W,
  MAX_SUB,
  ORIGIN,
  THICK_GAP,
  Y_LIFT
} from './scene-config.ts'
import { movePlayerTo } from '~system/RestrictedActions'
import { ActionHistory } from './action-history'
import * as Core from './hexbrick-core'
import { COLORS, hexToColor4 } from './palette'
import {
  BrickRecord,
  requestBreak,
  requestLay,
  requestPaint
} from './persistence'

type Entity = ReturnType<typeof engine.addEntity>

const REACH = 14
const HSUB = Core.HSUB
const APRON_LIFT = 0.02
const YAW_PER_ROT = -60
const SOLID_COLLIDERS = ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS

const world = Core.createWorld({ halfWidth: FLOOR_W / 2, halfDepth: FLOOR_D / 2, maxSub: MAX_SUB })
const cellKey = (c: Core.TriCell) => `${c.a},${c.b},${c.d}`
const footprint = (b: Core.Brick) => new Set(Core.elemsFor(b.defIdx, b.rotK, b.a0, b.b0).map(cellKey))
const wrap = (i: number, n: number) => ((i % n) + n) % n
const brickModel = (defIdx: number, color: number) => ({
  src: `models/brick-${defIdx}-${color}.glb`,
  visibleMeshesCollisionMask: SOLID_COLLIDERS,
  invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
})

export const ACTIONS = ['Place', 'Delete', 'Paint'] as const

export const state = {
  sel: 0,
  rot: 0,
  ghostRot: null as number | null,
  color: 0,
  thick: BLOCK_HEIGHTS[0] as number,
  rememberRotation: false,
  count: 0,
  action: 0
}

export function undoDepth(): number {
  return history.undoDepth()
}
const brickEnts = new Map<number, Entity>()
const brickColors = new Map<number, number>()
const entToBrick = new Map<Entity, number>()
type RedoRec = { defIdx: number; a0: number; b0: number; ys0: number; rotK: number; color: number; thick: number }
type BrickRef = RedoRec & { id: number }
type HistoryEntry =
  | { kind: 'place'; brick: BrickRef }
  | { kind: 'delete'; brick: BrickRef }
  | { kind: 'paint'; id: number; before: number; after: number }
const history = new ActionHistory<HistoryEntry>(128)

let board: Entity
let apron: Entity
let ghosts: Entity[] = []
let activeGhost = -1
let ghostTints: Array<GhostTint | null> = []

const GHOST_OK = Color4.create(0.56, 0.82, 0.42, 0.45)
const GHOST_OFF = Color4.create(1, 0.74, 0.36, 0.4)
const GHOST_BAD = Color4.create(0.88, 0.42, 0.35, 0.25)
const GHOST_DELETE = Color4.create(1, 0.12, 0.18, 0.58)
type GhostTint = 'ok' | 'off' | 'bad' | 'delete' | `paint:${number}`
let target: Core.PlacementTarget | null = null
let targetEnt: Entity | null = null
function sameTarget(a: Core.PlacementTarget | null, b: Core.PlacementTarget | null): boolean {
  return a === b || (a !== null && b !== null &&
    a.a === b.a && a.b === b.b && a.d === b.d && a.ys === b.ys)
}
let shown: {
  sel: number
  rot: number
  ys: number
  res: Core.PlacementResult
  hexPin?: string
} | null = null

function placementOpts(): Core.PlacementOptions {
  return { sel: state.sel, rot: state.rot, thick: state.thick, rememberRotation: state.rememberRotation }
}

function rescuePlayerFrom(brick: Core.Brick) {
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return
  if (!footprint(brick).has(cellKey(Core.triAt(player.x - ORIGIN.x, player.z - ORIGIN.z)))) return
  const bottom = BOARD_LIFT + brick.ys0 * HSUB
  const top = BOARD_LIFT + (brick.ys0 + brick.thick) * HSUB + Y_LIFT
  const AVATAR_HEIGHT = 1.8
  if (player.y >= top || player.y + AVATAR_HEIGHT <= bottom) return
  void movePlayerTo({
    newRelativePosition: { x: player.x, y: top + 2, z: player.z }
  }).catch((error) => console.error('[hexabricks] could not move player out of placed brick', error))
}

function spawnBrick(brick: Core.Brick, colorIdx: number, existingEntity?: Entity) {
  const e = existingEntity ?? engine.addEntity()
  if (existingEntity === undefined) {
    const p = Core.vertexPos(brick.a0, brick.b0)
    Transform.create(e, {
      position: Vector3.create(ORIGIN.x + p.x, BOARD_LIFT + brick.ys0 * HSUB + Y_LIFT, ORIGIN.z + p.z),
      rotation: Quaternion.fromEulerDegrees(0, YAW_PER_ROT * brick.rotK, 0),
      scale: Vector3.create(1, brick.thick * HSUB - THICK_GAP, 1)
    })
    GltfContainer.create(e, brickModel(brick.defIdx, colorIdx))
  }
  brickEnts.set(brick.id, e)
  brickColors.set(brick.id, colorIdx)
  entToBrick.set(e, brick.id)
  state.count = world.size()
  rescuePlayerFrom(brick)
}

function despawnBrick(id: number) {
  const brick = world.remove(id)
  if (!brick) return
  const e = brickEnts.get(id)
  if (e !== undefined) {
    engine.removeEntity(e)
    brickEnts.delete(id)
    entToBrick.delete(e)
  }
  brickColors.delete(id)
  state.count = world.size()
}

function targetFrom(hit: {
  position?: { x: number; y: number; z: number }
  normalHit?: { x: number; y: number; z: number }
  entityId?: number
}): Core.PlacementTarget | null {
  const p = hit.position
  if (!p || hit.entityId === undefined) return null
  const ent = hit.entityId as Entity
  let px = p.x
  let pz = p.z
  let ys: number
  if (ent === board || ent === apron) {
    ys = 0
  } else {
    const id = entToBrick.get(ent)
    if (id === undefined) return null
    const b = world.get(id)
    const n = hit.normalHit
    if (!b || !n) return null
    if (n.y > 0.5) {
      const RIM = 0.25
      const c = Core.triAt(px - ORIGIN.x, pz - ORIGIN.z)
      const mine = footprint(b)
      if (mine.has(cellKey(c))) {
        let best: Core.TriCell | null = null
        let bestDist = RIM
        const cs = Core.triCorners(c.a, c.b, c.d)
        for (const nb of Core.triNeighbors(c.a, c.b, c.d)) {
          if (mine.has(cellKey(nb))) continue
          const shared = Core.triCorners(nb.a, nb.b, nb.d).filter((q) =>
            cs.some((p) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6)
          )
          if (shared.length !== 2) continue
          const dist = pointToSegment(px - ORIGIN.x, pz - ORIGIN.z, shared[0], shared[1])
          if (dist < bestDist) {
            bestDist = dist
            best = nb
          }
        }
        if (best) return { a: best.a, b: best.b, d: best.d, ys: b.ys0 }
      }
      ys = b.ys0 + b.thick
    } else if (n.y < -0.5) {
      ys = b.ys0 - state.thick
      if (ys < 0) return null
    } else {
      ys = b.ys0
      const inCell = Core.triAt(px - n.x * 0.05 - ORIGIN.x, pz - n.z * 0.05 - ORIGIN.z)
      const mine = footprint(b)
      const c0 = Core.triCentroid(inCell.a, inCell.b, inCell.d)
      let best: Core.TriCell | null = null
      let bestDot = -Infinity
      for (const nb of Core.triNeighbors(inCell.a, inCell.b, inCell.d)) {
        if (mine.has(cellKey(nb))) continue
        const cc = Core.triCentroid(nb.a, nb.b, nb.d)
        const dot = (cc.x - c0.x) * n.x + (cc.z - c0.z) * n.z
        if (dot > bestDot) {
          bestDot = dot
          best = nb
        }
      }
      if (!best) return null
      return { a: best.a, b: best.b, d: best.d, ys }
    }
  }
  const c = Core.triAt(px - ORIGIN.x, pz - ORIGIN.z)
  return { a: c.a, b: c.b, d: c.d, ys }
}

function pointToSegment(x: number, z: number, p: Core.PointXZ, q: Core.PointXZ): number {
  const dx = q.x - p.x, dz = q.z - p.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / len2))
  return Math.hypot(x - (p.x + t * dx), z - (p.z + t * dz))
}

function hideGhost() {
  state.ghostRot = null
  shown = null
  if (activeGhost >= 0) Transform.getMutable(ghosts[activeGhost]).scale = Vector3.Zero()
  activeGhost = -1
}

function applyGhostTint(i: number, tint: GhostTint) {
  if (ghostTints[i] === tint) return
  ghostTints[i] = tint
  const paint = tint.startsWith('paint:') ? hexToColor4(COLORS[Number(tint.slice(6))].base, 0.58) : null
  GltfNodeModifiers.createOrReplace(ghosts[i], {
    modifiers: [
      {
        path: '',
        material: {
          material: {
            $case: 'pbr',
            pbr: {
              albedoColor:
                paint ?? (tint === 'ok' ? GHOST_OK : tint === 'off' ? GHOST_OFF : tint === 'delete' ? GHOST_DELETE : GHOST_BAD),
              transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
              metallic: 0,
              roughness: 1
            }
          }
        }
      }
    ]
  })
}

function showGhost(i: number, tint: GhostTint, b: Omit<Core.Brick, 'id'>, inflate: boolean) {
  if (activeGhost !== i && activeGhost >= 0) Transform.getMutable(ghosts[activeGhost]).scale = Vector3.Zero()
  activeGhost = i
  applyGhostTint(i, tint)
  const p = Core.vertexPos(b.a0, b.b0)
  const t = Transform.getMutable(ghosts[i])
  t.position = Vector3.create(ORIGIN.x + p.x, BOARD_LIFT + b.ys0 * HSUB + Y_LIFT, ORIGIN.z + p.z)
  t.rotation = Quaternion.fromEulerDegrees(0, YAW_PER_ROT * b.rotK, 0)
  const xz = inflate ? 1.015 : 1
  t.scale = Vector3.create(xz, b.thick * HSUB - THICK_GAP + (inflate ? 0.02 : 0), xz)
}

function drawShown() {
  if (!shown) return
  const res = shown.res
  state.ghostRot = res.rk
  showGhost(state.sel, res.ok ? (res.grabbed ? 'ok' : 'off') : 'bad',
    { defIdx: state.sel, a0: res.a0, b0: res.b0, ys0: shown.ys, rotK: res.rk, thick: state.thick }, false)
}

function targetBrick(): Core.Brick | undefined {
  const id = targetEnt === null ? undefined : entToBrick.get(targetEnt)
  return id === undefined ? undefined : world.get(id)
}

function drawTargetBrickGhost(mode: 'delete' | 'paint') {
  shown = null
  state.ghostRot = null
  const brick = targetBrick()
  if (!brick) return hideGhost()
  showGhost(brick.defIdx, mode === 'delete' ? 'delete' : `paint:${state.color}`, brick, true)
}

function hexKey(t: Core.PlacementTarget): string {
  const h = Core.hexOf(t.a, t.b, t.d)
  return `${h.a},${h.b}`
}

function updateGhost() {
  if (ACTIONS[state.action] === 'Delete') return drawTargetBrickGhost('delete')
  if (ACTIONS[state.action] === 'Paint') return drawTargetBrickGhost('paint')
  if (!target) return hideGhost()
  if (
    shown !== null &&
    shown.res.ok &&
    shown.sel === state.sel &&
    shown.rot === state.rot &&
    shown.ys === target.ys &&
    (Core.elemsFor(shown.sel, shown.res.rk, shown.res.a0, shown.res.b0).some(
      (e) => e.a === target!.a && e.b === target!.b && e.d === target!.d
    ) ||
      (shown.hexPin !== undefined && shown.hexPin === hexKey(target))) &&
    world.canPlace(shown.sel, shown.res.a0, shown.res.b0, shown.ys, shown.res.rk, state.thick)
  )
    return
  const res = world.resolvePlacement(target, placementOpts())
  if (!res) return hideGhost()
  shown = { sel: state.sel, rot: state.rot, ys: target.ys, res }
  drawShown()
}

export function selectShape(i: number) {
  state.sel = wrap(i, Core.SHAPES.length)
  updateGhost()
}
export function selectColor(i: number) {
  state.color = wrap(i, COLORS.length)
}
export function selectBlockHeight(thick: number) {
  if (!BLOCK_HEIGHTS.includes(thick)) return
  state.thick = thick
  shown = null
  updateGhost()
}
export function setRememberRotation(value: boolean) {
  state.rememberRotation = value
  shown = null
  updateGhost()
}

export function cyclePossiblePlacement() {
  if (!target || ACTIONS[state.action] !== 'Place') return
  const choices: Array<{ sel: number; res: Core.PlacementResult }> = []
  for (let sel = 0; sel < Core.SHAPES.length; sel++) {
    const res = world.resolvePlacement(target, { ...placementOpts(), sel })
    if (res?.ok) choices.push({ sel, res })
  }
  choices.sort((a, b) => b.res.contacts - a.res.contacts || a.sel - b.sel || a.res.rk - b.res.rk)
  if (choices.length === 0) return
  const current = choices.findIndex((choice) => choice.sel === state.sel)
  const choice = choices[(current + 1) % choices.length]
  state.sel = choice.sel
  if (!state.rememberRotation) state.rot = choice.res.rk
  shown = {
    sel: choice.sel,
    rot: state.rot,
    ys: target.ys,
    res: choice.res,
    hexPin: hexKey(target)
  }
  drawShown()
}
function footprintKey(res: Core.PlacementResult): string {
  return Core.elemsFor(state.sel, res.rk, res.a0, res.b0).map(cellKey).sort().join('|')
}
export function doRotate() {
  if (target && shown) {
    const hex = Core.hexOf(target.a, target.b, target.d)
    const fits = new Map<string, Core.PlacementResult>()
    for (const tw of Core.hexWedges(hex.a, hex.b))
      for (let rk = 0; rk < 6; rk++)
        for (const e of Core.ELEMS[state.sel][rk]) {
          if (e.d !== tw.d || Core.vclass(e.a, e.b) !== Core.vclass(tw.a, tw.b)) continue
          const a0 = tw.a - e.a, b0 = tw.b - e.b
          if (!world.canPlace(state.sel, a0, b0, target.ys, rk, state.thick)) continue
          const res: Core.PlacementResult = {
            a0,
            b0,
            rk,
            ok: true,
            grabbed: true,
            contacts: world.contactEdges(state.sel, a0, b0, target.ys, rk, state.thick)
          }
          const k = footprintKey(res)
          if (!fits.has(k)) fits.set(k, res)
        }
    const keys = [...fits.keys()]
    if (keys.length > 0) {
      const cur = keys.indexOf(footprintKey(shown.res))
      const next = fits.get(keys[(cur + 1) % keys.length])!
      state.rot = next.rk
      shown = {
        sel: state.sel,
        rot: next.rk,
        ys: target.ys,
        res: next,
        hexPin: `${hex.a},${hex.b}`
      }
      drawShown()
      return
    }
  }
  state.rot = (state.rot + 1) % 6
  updateGhost()
}
export function setAction(i: number) {
  state.action = wrap(i, ACTIONS.length)
  updateGhost()
}
function executeAction() {
  switch (ACTIONS[state.action]) {
    case 'Place':
      return layBrick()
    case 'Delete':
      return breakBrick()
    case 'Paint':
      return paintBrick()
  }
}
function brickRef(id: number): BrickRef | undefined {
  const b = world.get(id)
  const c = brickColors.get(id)
  if (!b || c === undefined) return undefined
  return { id, defIdx: b.defIdx, a0: b.a0, b0: b.b0, ys0: b.ys0, rotK: b.rotK, color: c, thick: b.thick }
}
function placeRecorded(rec: RedoRec): number | undefined {
  if (!world.canPlace(rec.defIdx, rec.a0, rec.b0, rec.ys0, rec.rotK, rec.thick))
    return undefined
  const id = requestLay(rec)
  if (id !== undefined) updateGhost()
  return id
}

function replay(isRedo: boolean) {
  let entry = isRedo ? history.takeRedo() : history.takeUndo()
  if (!entry) return
  let ok: boolean
  if (entry.kind === 'paint') ok = requestPaint(entry.id, isRedo ? entry.after : entry.before)
  else if ((entry.kind === 'place') === isRedo) {
    const id = placeRecorded(entry.brick)
    ok = id !== undefined
    if (ok) entry = { ...entry, brick: { ...entry.brick, id: id! } }
  } else ok = requestBreak(entry.brick.id)
  if (ok) isRedo ? history.commitRedo(entry) : history.commitUndo(entry)
  else isRedo ? history.cancelRedo(entry) : history.cancelUndo(entry)
}
export const undo = () => replay(false)
export const redo = () => replay(true)
function layBrick() {
  if (!target) return
  const res =
    shown && shown.sel === state.sel && shown.ys === target.ys
      ? shown.res
      : world.resolvePlacement(target, placementOpts())
  if (!res || !res.ok) return
  state.rot = res.rk
  const rec: RedoRec = {
    defIdx: state.sel,
    a0: res.a0,
    b0: res.b0,
    ys0: target.ys,
    rotK: res.rk,
    color: state.color,
    thick: state.thick
  }
  const id = placeRecorded(rec)
  if (id !== undefined) {
    history.record({ kind: 'place', brick: { ...rec, id } })
  }
}
function breakBrick() {
  const brick = targetBrick()
  const ref = brick && brickRef(brick.id)
  if (ref && requestBreak(ref.id)) history.record({ kind: 'delete', brick: ref })
}
function paintBrick() {
  const id = targetBrick()?.id
  const before = id === undefined ? undefined : brickColors.get(id)
  if (id === undefined || before === undefined || before === state.color) return
  if (requestPaint(id, state.color))
    history.record({ kind: 'paint', id, before, after: state.color })
}

export function applyRemotePaint(id: number, color: number) {
  const e = brickEnts.get(id)
  const brick = world.get(id)
  if (e === undefined || !brick || color < 0 || color >= COLORS.length) return
  brickColors.set(id, color)
  GltfContainer.createOrReplace(e, brickModel(brick.defIdx, color))
  updateGhost()
}

export function applyRemoteLay(rec: BrickRecord, existingEntity?: Entity) {
  const brick = world.restore({ ...rec, thick: rec.thick || BLOCK_HEIGHTS[0] })
  if (brick) spawnBrick(brick, rec.color, existingEntity)
}
export function applyRemoteBreak(id: number) {
  despawnBrick(id)
  updateGhost()
}

export function setupGame() {
  board = engine.addEntity()
  Transform.create(board, { position: Vector3.create(ORIGIN.x, BOARD_LIFT, ORIGIN.z) })
  GltfContainer.create(board, {
    src: 'models/board.glb',
    visibleMeshesCollisionMask: SOLID_COLLIDERS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  apron = engine.addEntity()
  Transform.create(apron, {
    position: Vector3.create(ORIGIN.x, APRON_LIFT, ORIGIN.z),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(FLOOR_W, FLOOR_D, 1)
  })
  const hu = FLOOR_W / 2 / (Core.S * Core.SQ3)
  const hv = FLOOR_D / 2 / (3 * Core.S)
  MeshRenderer.setPlane(apron, [
    -hu, -hv, -hu, hv, hu, hv, hu, -hv,
    hu, -hv, hu, hv, -hu, hv, -hu, -hv
  ])
  MeshCollider.setPlane(apron, SOLID_COLLIDERS)
  const floorTex = (src: string) =>
    Material.Texture.Common({ src, wrapMode: TextureWrapMode.TWM_REPEAT })
  Material.setPbrMaterial(apron, {
    texture: floorTex('models/hexfloor.png'),
    emissiveTexture: floorTex('models/hexfloor-emissive.png'),
    emissiveColor: Color3.White(),
    emissiveIntensity: 1,
    metallic: 0,
    roughness: 0.8
  })

  ghosts = Core.SHAPES.map((_, s) => {
    const g = engine.addEntity()
    Transform.create(g, { position: Vector3.create(0, -10, 0), scale: Vector3.Zero() })
    GltfContainer.create(g, {
      src: `models/ghost-${s}.glb`,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    return g
  })
  ghostTints = Core.SHAPES.map(() => null)

  console.log('[hexabricks] core v2 (vertex lattice) loaded')

  raycastSystem.registerLocalDirectionRaycast(
    {
      entity: engine.CameraEntity,
      opts: {
        queryType: RaycastQueryType.RQT_QUERY_ALL,
        direction: Vector3.Forward(),
        maxDistance: REACH,
        continuous: true,
        collisionMask: ColliderLayer.CL_POINTER
      }
    },
    (res) => {
      let best: (typeof res.hits)[number] | null = null
      for (const h of res.hits) {
        if (!h.position || h.entityId === undefined) continue
        if (!best || h.length < best.length) best = h
      }
      const nextTarget = best ? targetFrom(best) : null
      const hitEnt = best?.entityId as Entity | undefined
      const nextTargetEnt = hitEnt !== undefined && entToBrick.has(hitEnt) ? hitEnt : null
      const changed = !sameTarget(target, nextTarget) || targetEnt !== nextTargetEnt
      target = nextTarget
      targetEnt = nextTargetEnt
      if (changed) updateGhost()
    }
  )

  const RESET_HOLD_S = 0.4
  let fHeld = false
  let fTime = 0
  const cameraEvent = (action: number, event: number) =>
    inputSystem.isTriggered(action, event, engine.CameraEntity)
  const down = (action: number) => cameraEvent(action, PointerEventType.PET_DOWN)
  engine.addSystem((dt) => {
    if (down(InputAction.IA_POINTER)) executeAction()
    if (down(InputAction.IA_PRIMARY)) executeAction()
    if (down(InputAction.IA_SECONDARY)) {
      fHeld = true
      fTime = 0
    }
    if (fHeld) {
      fTime += dt
      if (fTime >= RESET_HOLD_S) {
        fHeld = false
        setAction(0)
      } else if (cameraEvent(InputAction.IA_SECONDARY, PointerEventType.PET_UP)) {
        fHeld = false
        setAction(state.action + 1)
      } else if (!inputSystem.isPressed(InputAction.IA_SECONDARY)) {
        fHeld = false
      }
    }
    if (down(InputAction.IA_ACTION_3)) cyclePossiblePlacement()
    if (down(InputAction.IA_ACTION_4)) doRotate()
    if (down(InputAction.IA_ACTION_5)) selectShape(state.sel + 1)
    if (down(InputAction.IA_ACTION_6)) undo()
  })
}
