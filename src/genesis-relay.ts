import type { BrickWireRecord as BrickRecord } from './brick-wire.ts'
import { decodeBrick as record, encodeBrick as tuple } from './brick-wire.ts'

interface BuilderEntry { addr: string; name: string; invitedBy: string; at: number }

const RELAY_URL = 'wss://interconnected.online/hexabricks/ws'
const PROTOCOL_VERSION = 1
interface RelayHooks {
  address(): string
  seed(): BrickRecord[]
  snapshot(records: BrickRecord[], deleted: number[], builders: BuilderEntry[]): void
  upsert(record: BrickRecord): void
  remove(id: number): void
  repaint(id: number, color: number): void
  reject(id: number): void
  upsertBuilder(builder: BuilderEntry): void
}

function builder(value: unknown): BuilderEntry | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const [addr, name, invitedBy, at] = value
  if (
    typeof addr !== 'string' ||
    typeof name !== 'string' ||
    typeof invitedBy !== 'string' ||
    !Number.isSafeInteger(at)
  ) return null
  return { addr: addr.toLowerCase(), name, invitedBy: invitedBy.toLowerCase(), at }
}

export interface GenesisRelay {
  tick(dt: number): void
  lay(rec: BrickRecord): boolean
  breakBrick(id: number): boolean
  paint(id: number, color: number): boolean
  pendingCount(): number
  dispose(): void
}

interface RelayOptions {
  url?: string
  createSocket?: (url: string) => WebSocket
  actorId?: string
  onStatus?: (status: 'connecting' | 'syncing' | 'live' | 'offline') => void
}

export function createGenesisRelay(hooks: RelayHooks, options: RelayOptions = {}): GenesisRelay {
  let socket: WebSocket | null = null
  let ready = false
  let retryIn = 0
  let retryDelay = 2
  let lamport = 0
  let disposed = false
  const actorId = options.actorId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  type PendingOp = {
    raw: string
    opId: string
    lamport: number
    kind: 'lay' | 'delete' | 'paint'
    record?: BrickRecord
    id: number
    color?: number
  }
  const pending = new Map<string, PendingOp>()
  const versions = new Map<number, { l: number; k: string }>()

  function nextVersion(): { l: number; o: string } {
    const l = ++lamport
    return { l, o: `${actorId}:${l}` }
  }

  function observe(value: unknown): void {
    if (Number.isSafeInteger(value) && Number(value) >= 0) lamport = Math.max(lamport, Number(value))
  }

  function acknowledge(opId: unknown): void {
    if (typeof opId !== 'string') return
    for (const [key, op] of pending)
      if (op.opId === opId) {
        pending.delete(key)
        return
      }
  }

  function accept(id: number, rawClock: unknown, rawActor: unknown): boolean {
    if (!Number.isSafeInteger(rawClock) || Number(rawClock) < 0 || typeof rawActor !== 'string') return true
    const incoming = { l: Number(rawClock), k: rawActor }
    const current = versions.get(id)
    if (current && (incoming.l < current.l || (incoming.l === current.l && incoming.k < current.k))) return false
    versions.set(id, incoming)
    return true
  }

  function send(raw: string): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(raw)
    return true
  }

  function connect() {
    if (disposed) return
    if (socket && socket.readyState < WebSocket.CLOSING) return
    options.onStatus?.('connecting')
    try {
      const ws = options.createSocket
        ? options.createSocket(options.url ?? RELAY_URL)
        : new WebSocket(options.url ?? RELAY_URL)
      socket = ws
      ws.onopen = () => {
        retryDelay = 2
        options.onStatus?.('syncing')
        send(JSON.stringify({ t: 'h', v: PROTOCOL_VERSION, a: hooks.address(), s: actorId }))
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        let msg: { t?: string; b?: unknown; d?: unknown; i?: unknown; c?: unknown; l?: unknown; k?: unknown; o?: unknown }
        try {
          msg = JSON.parse(event.data) as typeof msg
        } catch {
          return
        }
        observe(msg.l)
        acknowledge(msg.o)
        if (msg.t === 's' && Array.isArray(msg.b)) {
          const records = msg.b.map(record).filter((x): x is BrickRecord => x !== null)
          const deleted = Array.isArray(msg.d)
            ? msg.d.filter((x): x is number => Number.isSafeInteger(x))
            : []
          const builders = Array.isArray(msg.i)
            ? msg.i.map(builder).filter((x): x is BuilderEntry => x !== null)
            : []
          versions.clear()
          if (Array.isArray(msg.c))
            for (const value of msg.c)
              if (Array.isArray(value) && Number.isSafeInteger(value[0]) && Number.isSafeInteger(value[1]) &&
                  typeof value[2] === 'string')
                versions.set(value[0], { l: value[1], k: value[2] })
          const snapshotRecords = new Map(records.map((rec) => [rec.id, rec]))
          const snapshotDeleted = new Set(deleted)
          for (const rec of records) pending.delete(`l:${rec.id}`)
          for (const id of deleted) pending.delete(`d:${id}`)
          for (const op of pending.values()) {
            if (op.kind === 'paint' && snapshotRecords.get(op.id)?.color === op.color)
              pending.delete(`p:${op.id}`)
          }
          for (const op of pending.values()) {
            versions.set(op.id, {
              l: op.lamport,
              k: actorId
            })
            if (op.kind === 'lay' && op.record && !snapshotDeleted.has(op.id))
              snapshotRecords.set(op.id, op.record)
            else if (op.kind === 'paint' && op.color !== undefined) {
              const rec = snapshotRecords.get(op.id)
              if (rec) snapshotRecords.set(op.id, { ...rec, color: op.color })
            } else if (op.kind === 'delete') {
              snapshotRecords.delete(op.id)
              snapshotDeleted.add(op.id)
            }
          }
          hooks.snapshot([...snapshotRecords.values()], [...snapshotDeleted], builders)
          ready = true
          options.onStatus?.('live')
          const known = new Set<number>(deleted)
          for (const rec of records) known.add(rec.id)
          const recovery = hooks.seed().filter((rec) => !known.has(rec.id))
          if (recovery.length) send(JSON.stringify({ t: 'm', b: recovery.map(tuple) }))
          for (const op of pending.values()) send(op.raw)
          console.log(`[hexabricks] Genesis persistence connected (${records.length} saved bricks)`)
          return
        }
        if (msg.t === 'u') {
          const rec = record(msg.b)
          if (!rec) return
          if (!accept(rec.id, msg.l, msg.k)) return
          hooks.upsert(rec)
          return
        }
        if (msg.t === 'i') {
          const entry = builder(msg.b)
          if (!entry) return
          hooks.upsertBuilder(entry)
          return
        }
        const id = msg.d
        if (typeof id !== 'number' || !Number.isSafeInteger(id)) return
        if (msg.t === 'x') {
          if (!accept(id, msg.l, msg.k)) return
          hooks.remove(id)
        }
        if (msg.t === 'p' && typeof msg.c === 'number' && Number.isSafeInteger(msg.c) && msg.c >= 0 && msg.c < 8) {
          if (!accept(id, msg.l, msg.k)) return
          hooks.repaint(id, msg.c)
        }
        if (msg.t === 'n') hooks.reject(id)
      }
      ws.onclose = () => {
        if (socket !== ws) return
        ready = false
        if (!disposed) dropSocket()
      }
    } catch {
      dropSocket()
    }
  }

  function dropSocket() {
    socket = null
    options.onStatus?.('offline')
    retryIn = retryDelay
    retryDelay = Math.min(30, retryDelay * 2)
  }

  function enqueue(key: string, body: object, op: Omit<PendingOp, 'raw' | 'opId' | 'lamport'>): boolean {
    const version = nextVersion()
    versions.set(op.id, { l: version.l, k: actorId })
    const raw = JSON.stringify({ ...body, ...version })
    pending.set(key, { raw, opId: version.o, lamport: version.l, ...op })
    if (ready) send(raw)
    return true
  }

  connect()
  return {
    tick(dt) {
      if (disposed || socket) return
      retryIn -= dt
      if (retryIn <= 0) connect()
    },
    lay: (rec) => enqueue(`l:${rec.id}`, { t: 'l', b: tuple(rec) }, { kind: 'lay', record: rec, id: rec.id }),
    breakBrick: (id) => enqueue(`d:${id}`, { t: 'd', d: id }, { kind: 'delete', id }),
    paint: (id, color) => enqueue(`p:${id}`, { t: 'p', d: id, c: color }, { kind: 'paint', id, color }),
    pendingCount() { return pending.size },
    dispose() {
      disposed = true
      ready = false
      socket?.close()
      socket = null
    }
  }
}
