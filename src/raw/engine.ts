import {
  APPEND_VALUE,
  BUILTIN_SPECS,
  CrdtWriter,
  DELETE_COMPONENT,
  DELETE_ENTITY,
  IDS,
  PUT_COMPONENT,
  equal,
  parseCrdt,
  type ComponentSpec
} from './protocol.ts'
import { createComponent, type Component } from './component-store.ts'

type Entity = number
type Vector3 = { x: number; y: number; z: number }
type ButtonCommand = { button: number; state: number; timestamp: number; [key: string]: any }
type FrameCommand = { entity: Entity; command: ButtonCommand }

export interface RayHit {
  position?: Vector3
  normalHit?: Vector3
  entityId?: Entity
  length: number
}

export interface RaycastResult { hits: RayHit[] }

interface RaycastOptions {
  originOffset?: Vector3
  direction?: Vector3
  maxDistance?: number
  queryType?: number
  continuous?: boolean
  collisionMask?: number
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index++)
    if (left[index] !== right[index]) return false
  return true
}

const EMPTY_CRDT = new Uint8Array()

export function createRawEngine() {
  const byId = new Map<number, Component<any>>()
  const byName = new Map<string, Component<any>>()
  const systems: Array<(deltaTime: number) => void> = []
  const deleted = new Set<Entity>()
  const alive = new Set<Entity>([0, 1, 2])
  const changedRaycasts = new Set<Entity>()
  const frameCommands: FrameCommand[] = []
  const buttons = new Map<number, ButtonCommand>()
  const rayCallbacks = new Map<Entity, (result: RaycastResult) => void>()
  const pendingRaycasts: Array<() => void> = []
  let nextEntity = 512

  function register<T>(spec: ComponentSpec<T>): Component<T> {
    const item = createComponent(spec)
    byId.set(item.componentId, item)
    byName.set(item.componentName, item)
    return item
  }
  for (const spec of BUILTIN_SPECS) register(spec)

  function noteEntity(entity: Entity): void {
    alive.add(entity)
    nextEntity = Math.max(nextEntity, (entity & 0xffff) + 1)
  }

  function beginFrame(): void {
    changedRaycasts.clear()
    frameCommands.length = 0
  }

  function applyChunk(data: Uint8Array, source = 'renderer'): void {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) return
    for (const message of parseCrdt(data)) {
      noteEntity(message.entity)
      if (message.type === DELETE_ENTITY) {
        alive.delete(message.entity)
        for (const item of byId.values()) {
          if (item._values.has(message.entity)) item._notify(message.entity, undefined)
          item._forget(message.entity)
        }
        continue
      }
      const item = byId.get(message.component)
      if (!item) continue
      const priorClock = item._clocks.get(message.entity) ?? -1
      if (message.type === APPEND_VALUE) {
        const decoded = item.codec.decode(message.data)
        if (message.component === IDS.PointerEventsResult)
          frameCommands.push({ entity: message.entity, command: decoded as ButtonCommand })
        else {
          const values = item._values.get(message.entity) ?? []
          values.push(decoded)
          item._values.set(message.entity, values)
        }
        item._clocks.set(message.entity, Math.max(priorClock, message.timestamp))
        item._notify(message.entity, decoded)
        continue
      }
      if (message.timestamp < priorClock) continue
      if (message.type === DELETE_COMPONENT) {
        item._values.delete(message.entity)
        item._sent.delete(message.entity)
        item._notify(message.entity, undefined)
      } else if (message.type === PUT_COMPONENT) {
        const decoded = item.codec.decode(message.data)
        item._values.set(message.entity, decoded)
        item._sent.set(message.entity, message.data.slice())
        if (message.component === IDS.PointerEventsResult)
          frameCommands.push({ entity: message.entity, command: decoded as ButtonCommand })
        item._notify(message.entity, decoded)
      }
      if (message.type === PUT_COMPONENT && message.component === IDS.RaycastResult)
        changedRaycasts.add(message.entity)
      item._clocks.set(message.entity, message.timestamp)
      item._dirty.delete(message.entity)
    }
    for (const { command } of frameCommands) {
      if (command.state !== 0 && command.state !== 1) continue
      const previous = buttons.get(command.button)
      if (!previous || command.timestamp >= previous.timestamp) buttons.set(command.button, command)
    }
    if (source === 'state') changedRaycasts.clear()
  }

  function flush(): Uint8Array {
    let writer: CrdtWriter | undefined
    for (const item of byId.values()) {
      if (!item.renderer) {
        item._dirty.clear()
        continue
      }
      for (const [entity, operation] of item._dirty) {
        if (deleted.has(entity)) continue
        if (operation === 'delete' && !item._sent.has(entity)) continue
        let data: Uint8Array | undefined
        if (operation !== 'delete') {
          const value = item._values.get(entity)
          if (value === undefined) continue
          data = item.codec.encode(value)
          if (sameBytes(item._sent.get(entity), data)) continue
        }
        const timestamp = (item._clocks.get(entity) ?? 0) + 1
        item._clocks.set(entity, timestamp)
        writer ??= new CrdtWriter()
        if (operation === 'delete') {
          writer.deleteComponent(entity, item.componentId, timestamp)
          item._sent.delete(entity)
        } else {
          writer.put(entity, item.componentId, timestamp, data!)
          item._sent.set(entity, data!)
        }
      }
      item._dirty.clear()
    }
    for (const entity of deleted) {
      writer ??= new CrdtWriter()
      writer.deleteEntity(entity)
    }
    deleted.clear()
    return writer?.take() ?? EMPTY_CRDT
  }

  const engine = {
    RootEntity: 0,
    PlayerEntity: 1,
    CameraEntity: 2,
    addEntity(): Entity {
      if (nextEntity >= 0xffff) throw new Error('entity range exhausted')
      const entity = nextEntity++
      alive.add(entity)
      return entity
    },
    removeEntity(entity: Entity): void {
      if (!alive.has(entity)) return
      alive.delete(entity)
      deleted.add(entity)
      for (const item of byId.values()) item._forget(entity)
    },
    addSystem(fn: (deltaTime: number) => void): void { systems.push(fn) },
    getComponent(idOrName: number | string): Component<any> {
      const item = typeof idOrName === 'number' ? byId.get(idOrName) : byName.get(idOrName)
      if (!item) throw new Error(`component ${idOrName} is not registered`)
      return item
    },
    *getEntitiesWith<T>(item: Component<T>): IterableIterator<[Entity, T]> {
      for (const [entity, value] of item._values) {
        if (!alive.has(entity)) continue
        yield [entity, value]
      }
    }
  }

  function findCommand(action: number, eventType: number, entity?: Entity): ButtonCommand | null {
    for (let index = frameCommands.length - 1; index >= 0; index--) {
      const item = frameCommands[index]
      if ((entity === undefined || item.entity === entity)
        && item.command.button === action
        && item.command.state === eventType) return item.command
    }
    return null
  }

  const inputSystem = {
    isTriggered: (action: number, eventType: number, entity?: Entity): boolean =>
      findCommand(action, eventType, entity) !== null,
    isPressed: (action: number): boolean => buttons.get(action)?.state === 1
  }

  const raycastSystem = {
    registerLocalDirectionRaycast(
      { entity, opts }: { entity: Entity; opts: RaycastOptions },
      callback: (result: RaycastResult) => void
    ): void {
      pendingRaycasts.push(() => {
        byId.get(IDS.Raycast)!.createOrReplace(entity, {
          timestamp: undefined,
          originOffset: opts.originOffset ?? { x: 0, y: 0, z: 0 },
          direction: {
            $case: 'localDirection',
            localDirection: opts.direction ?? { x: 0, y: 0, z: 1 }
          },
          maxDistance: opts.maxDistance ?? 16,
          queryType: opts.queryType ?? 0,
          continuous: opts.continuous ?? false,
          collisionMask: opts.collisionMask ?? 2
        })
        rayCallbacks.set(entity, callback)
      })
    }
  }

  function runSystems(deltaTime: number): void {
    if (pendingRaycasts.length) {
      const installs = pendingRaycasts.splice(0)
      for (const install of installs) install()
    }
    for (const [entity, callback] of rayCallbacks) {
      if (!changedRaycasts.has(entity)) continue
      const result = byId.get(IDS.RaycastResult)!.getOrNull(entity) as RaycastResult | null
      if (result) callback(result)
    }
    for (const system of systems) system(deltaTime)
  }

  function setIfChanged<T>(item: Component<T>, entity: Entity, value: T): T {
    const previous = item.getOrNull(entity)
    if (previous !== null && equal(previous, value)) return previous
    return item.createOrReplace(entity, value)
  }

  return {
    componentEntries: (id: number): Array<[Entity, any]> =>
      [...(byId.get(id)?._values.entries() ?? [])],
    engine,
    inputSystem,
    raycastSystem,
    beginFrame,
    applyChunk,
    flush,
    runSystems,
    setIfChanged,
    getComponent: engine.getComponent
  }
}
