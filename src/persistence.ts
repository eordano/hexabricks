import {
  GltfContainer,
  Transform,
  engine
} from './raw/shims/ecs.ts'
import players from './raw/shims/players.ts'
import { INITIAL_BUILDERS, OPEN_BUILD } from './access-config.ts'
import { BAKED_BRICKS, BAKED_BY, BAKED_FIRST_ENTITY } from './baked-bricks.ts'
import { getRealm } from '~system/Runtime'
import { DirtyBrickMirror } from './brick-mirror'
import { createGenesisRelay, GenesisRelay } from './genesis-relay'
import { resolvePlayerTarget } from './player-names'

type Entity = ReturnType<typeof engine.addEntity>

const PROFILE_URL = 'https://peer.decentraland.org/lambdas/profiles/'
const BOOTSTRAP_S = 3

export interface BrickRecord {
  id: number
  defIdx: number
  a0: number
  b0: number
  ys0: number
  rotK: number
  color: number
  thick: number
  by: string
  at: number
}

export interface BuilderEntry {
  addr: string
  name: string
  invitedBy: string
  at: number
}

interface ClientHooks {
  applyRemoteLay(rec: BrickRecord, existingEntity?: Entity): void
  applyRemoteBreak(id: number): void
  applyRemotePaint(id: number, color: number): void
}

const BrickData = engine.getComponent('hexabricks::brick')

const client = {
  myAddress: '',
  builders: [...INITIAL_BUILDERS] as BuilderEntry[],
  lastNotice: '',
  dataRevision: 0
}
const seenNames = new Map<string, string>()
const present = new Set<string>()
const profileLookups = new Set<string>()
const relayRecords = new Map<number, BrickRecord>()
const relayDeleted = new Set<number>()
const queuedRelayOps = new Map<string, (relay: GenesisRelay) => void>()
let relay: GenesisRelay | null = null
let idSession = 0
let idCounter = 0
let mirror: DirtyBrickMirror<Entity> | null = null

function flushMirror(): void {
  mirror?.flush()
}

function changed(): void {
  client.dataRevision++
}

function sync(): void {
  changed()
  flushMirror()
}

function rememberPlayer(player: { userId: string; name: string }): void {
  const addr = player.userId.toLowerCase()
  present.add(addr)
  if (player.name) seenNames.set(addr, player.name)
}

players.onEnterScene(rememberPlayer)
players.onLeaveScene((userId) => present.delete(userId.toLowerCase()))
const initialPlayer = players.getPlayer()
if (initialPlayer) rememberPlayer(initialPlayer)

function hydrateProfileName(addr: string): void {
  if (seenNames.has(addr) || profileLookups.has(addr) || !/^0x[0-9a-f]{40}$/.test(addr)) return
  profileLookups.add(addr)
  fetch(PROFILE_URL + addr)
    .then((response) => response.ok ? response.json() : null)
    .then((profile: { avatars?: Array<{ name?: string; userId?: string }> } | null) => {
      const avatar = profile?.avatars?.[0]
      if (!avatar?.name || (avatar.userId && avatar.userId.toLowerCase() !== addr)) return
      seenNames.set(addr, avatar.name)
      changed()
    })
    .catch(() => {})
}

function knownPlayerNames(): Array<{ addr: string; name: string }> {
  const known = new Map<string, string>()
  for (const builder of client.builders) if (builder.name) known.set(builder.addr, builder.name)
  for (const [addr, name] of seenNames) known.set(addr, name)
  return [...known].map(([addr, name]) => ({ addr, name }))
}

function mutateBuilders(fn: (entries: BuilderEntry[]) => BuilderEntry[]): void {
  client.builders = fn([...client.builders])
  changed()
}

function ownOrHost(owner: string): boolean {
  return OPEN_BUILD || owner.toLowerCase() === client.myAddress ||
    client.builders.some((entry) => entry.addr === client.myAddress && entry.invitedBy === '')
}

function hydrateBaked(): void {
  BAKED_BRICKS.forEach((row, index) => {
    const entity = (BAKED_FIRST_ENTITY + index) as Entity
    if (BrickData.has(entity) || !GltfContainer.has(entity)) return
    const [brickId, defIdx, a0, b0, ys0, rotK, color, thick, byIndex, at] = row
    BrickData.create(entity, { brickId, defIdx, a0, b0, ys0, rotK, color, thick, by: BAKED_BY[byIndex] ?? '', at })
  })
}

function bakedEntity(brickId: number): [Entity, ReturnType<typeof BrickData.get>] | undefined {
  for (const pair of engine.getEntitiesWith(BrickData)) if (pair[1].brickId === brickId) return pair
}

function hostBlocks(brickId: number, baked: ReturnType<typeof bakedEntity>, verb: string): boolean {
  const by = baked ? baked[1].by : relayRecords.get(brickId)?.by
  if (by === undefined || ownOrHost(by)) return false
  client.lastNotice = `Only the host can ${verb} bricks laid by others.`
  return true
}

function adoptAddress(): void {
  if (!client.myAddress) client.myAddress = (players.getPlayer()?.userId ?? '').toLowerCase()
}

function queueRelay(key: string, operation: (active: GenesisRelay) => void): void {
  if (relay) operation(relay)
  else queuedRelayOps.set(key, operation)
}

function mintBrickId(): number {
  if (idSession === 0) {
    const addrBits = (parseInt(client.myAddress.slice(-6) || '1', 16) || 1) & 0x1fffff
    idSession = (addrBits * 256 + Math.floor(Math.random() * 255) + 1) * 16777216
  }
  return idSession + idCounter++
}

function toRecord(data: ReturnType<typeof BrickData.get>, id = data.brickId): BrickRecord {
  return {
    id,
    defIdx: data.defIdx,
    a0: data.a0,
    b0: data.b0,
    ys0: data.ys0,
    rotK: data.rotK,
    color: data.color,
    thick: data.thick || 2,
    by: data.by,
    at: Number(data.at)
  }
}

export function persistenceRevision(): number {
  return client.dataRevision
}

function canBuild(): boolean {
  return OPEN_BUILD || client.builders.length === 0 ||
    client.builders.some((entry) => entry.addr === client.myAddress)
}

export function buildersList(): readonly BuilderEntry[] {
  return client.builders
}

export function lastNotice(): string {
  return client.lastNotice
}

export function nameOf(addr: string): string | undefined {
  const normalized = addr.toLowerCase()
  const visible = players.getPlayer({ userId: normalized })
  if (visible?.name) seenNames.set(normalized, visible.name)
  const known = seenNames.get(normalized) ||
    client.builders.find((builder) => builder.addr === normalized)?.name || undefined
  if (!known) hydrateProfileName(normalized)
  return known
}

export function invitablePlayers(): Array<{ addr: string; name: string }> {
  return [...present]
    .filter((addr) => addr !== client.myAddress && !client.builders.some((b) => b.addr === addr))
    .map((addr) => ({ addr, name: seenNames.get(addr) ?? addr }))
}

export function layEvents(): Array<{ by: string; at: number }> {
  const out: Array<{ by: string; at: number }> = []
  const seen = new Set<number>()
  for (const record of relayRecords.values()) {
    seen.add(record.id)
    out.push({ by: record.by, at: record.at })
  }
  for (const [, data] of engine.getEntitiesWith(BrickData)) {
    if (relayDeleted.has(data.brickId) || seen.has(data.brickId)) continue
    out.push({ by: data.by, at: Number(data.at) })
  }
  return out
}

export function requestLay(data: Omit<BrickRecord, 'id' | 'by' | 'at'>): number | undefined {
  if (!canBuild()) return undefined
  const record: BrickRecord = {
    ...data,
    id: mintBrickId(),
    by: client.myAddress,
    at: Date.now()
  }
  const entity = engine.addEntity()
  BrickData.create(entity, { ...record, brickId: record.id })
  mirror?.bake(entity, record)
  queueRelay(`l:${record.id}`, (active) => active.lay(record))
  sync()
  return record.id
}

export function requestBreak(brickId: number): boolean {
  const baked = bakedEntity(brickId)
  if (hostBlocks(brickId, baked, 'break')) return false
  if (baked) engine.removeEntity(baked[0])
  relayRecords.delete(brickId)
  relayDeleted.add(brickId)
  mirror?.deleteBaked(brickId)
  queueRelay(`d:${brickId}`, (active) => active.breakBrick(brickId))
  sync()
  return true
}

export function requestPaint(brickId: number, color: number): boolean {
  if (!canBuild() || !Number.isSafeInteger(color) || color < 0 || color >= 8) return false
  const baked = bakedEntity(brickId)
  if (hostBlocks(brickId, baked, 'paint')) return false
  if (baked) {
    BrickData.getMutable(baked[0]).color = color
    mirror?.bake(baked[0], { ...toRecord(baked[1]), color })
  }
  const relayRecord = relayRecords.get(brickId)
  if (relayRecord) relayRecords.set(brickId, { ...relayRecord, color })
  flushMirror()
  queueRelay(`p:${brickId}`, (active) => active.paint(brickId, color))
  return true
}

export function requestInvite(target: string): void {
  const resolved = resolvePlayerTarget(target, knownPlayerNames())
  if (resolved.kind === 'ambiguous') {
    client.lastNotice = `More than one nearby player is named ${target}; use their address.`
    return
  }
  if (resolved.kind === 'missing') {
    client.lastNotice = `No known player named ${target}; use their 0x address.`
    return
  }
  const addr = resolved.addr
  const displayName = nameOf(addr) ?? addr
  if (client.builders.some((builder) => builder.addr === addr)) {
    client.lastNotice = `${displayName} is already a bricklayer.`
    return
  }
  if (!canBuild()) return
  mutateBuilders((entries) => [...entries, {
    addr,
    name: nameOf(addr) ?? '',
    invitedBy: client.myAddress,
    at: Date.now()
  }])
  client.lastNotice = `Invited ${displayName}.`
}

export function requestBan(address: string): void {
  const banned = new Set<string>([address.toLowerCase()])
  mutateBuilders((entries) => {
    for (let size = -1; size !== banned.size;) {
      size = banned.size
      for (const entry of entries) if (banned.has(entry.invitedBy)) banned.add(entry.addr)
    }
    return entries.filter((entry) => !banned.has(entry.addr))
  })
}

export function setupPersistenceClient(hooks: ClientHooks): void {
  adoptAddress()
  if (!client.myAddress) players.onEnterScene(adoptAddress)
  changed()
  console.log('[hexabricks] persistence server mode; local-first fallback enabled')

  const activeMirror = new DirtyBrickMirror<Entity>({
    lay: (record, bakedEntity) => {
      const baked = bakedEntity !== undefined && Transform.has(bakedEntity) && GltfContainer.has(bakedEntity)
        ? bakedEntity : undefined
      hooks.applyRemoteLay(record, baked)
    },
    breakBrick: hooks.applyRemoteBreak,
    paint: hooks.applyRemotePaint
  })
  mirror = activeMirror
  hydrateBaked()
  for (const [entity, data] of engine.getEntitiesWith(BrickData))
    activeMirror.bake(entity, toRecord(data))
  flushMirror()

  const startRelay = () => {
    if (relay || !client.myAddress) return
    relay = createGenesisRelay({
      address: () => client.myAddress,
      seed: () => activeMirror.seed(),
      snapshot: (records, deleted, builders) => {
        relayRecords.clear()
        relayDeleted.clear()
        for (const id of deleted) relayDeleted.add(id)
        for (const record of records)
          if (!relayDeleted.has(record.id)) relayRecords.set(record.id, record)
        activeMirror.snapshot(records, deleted)
        client.builders = builders
        sync()
      },
      upsert: (record) => {
        relayDeleted.delete(record.id)
        relayRecords.set(record.id, record)
        activeMirror.upsert(record)
        sync()
      },
      remove: (id) => {
        relayRecords.delete(id)
        relayDeleted.add(id)
        activeMirror.remove(id)
        sync()
      },
      repaint: (id, color) => {
        const record = relayRecords.get(id)
        if (record) relayRecords.set(id, { ...record, color })
        activeMirror.repaint(id, color)
        flushMirror()
      },
      reject: (id) => {
        const baked = bakedEntity(id)
        if (baked) engine.removeEntity(baked[0])
        relayRecords.delete(id)
        activeMirror.deleteBaked(id)
        activeMirror.snapshot([...relayRecords.values()], [...relayDeleted])
        flushMirror()
        client.lastNotice = 'That placement was taken by another builder.'
      },
      upsertBuilder: (builder) => mutateBuilders((entries) =>
        [...entries.filter((entry) => entry.addr !== builder.addr), builder]
      )
    })
    for (const operation of queuedRelayOps.values()) operation(relay)
    queuedRelayOps.clear()
  }

  void getRealm({})
    .then((realm) => {
      if (realm.realmInfo?.isPreview !== false) return
      startRelay()
      if (!relay)
        players.onEnterScene(() => {
          adoptAddress()
          startRelay()
        })
    })
    .catch(() => console.log('[hexabricks] realm unavailable; durable peer disabled'))

  let bootElapsed = 0
  let booted = OPEN_BUILD
  engine.addSystem((dt) => {
    relay?.tick(dt)
    if (booted) return
    bootElapsed += dt
    const delay = BOOTSTRAP_S + ((parseInt(client.myAddress.slice(-2) || '0', 16) || 0) % 20) / 10
    if (bootElapsed < delay || !client.myAddress) return
    booted = true
    if (client.builders.length !== 0) return
    mutateBuilders(() => [{
      addr: client.myAddress,
      name: seenNames.get(client.myAddress) ?? '',
      invitedBy: '',
      at: Date.now()
    }])
    client.lastNotice = 'You host this wall - invite builders from the panel.'
  })
}
