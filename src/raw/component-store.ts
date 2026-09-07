import { clone, type Codec, type ComponentSpec } from './protocol.ts'

type Entity = number
type Operation = 'put' | 'delete'

export interface Component<T = any> {
  readonly componentName: string
  readonly componentId: number
  readonly codec: Codec<T>
  readonly renderer: boolean
  create(entity: Entity, value?: T): T
  createOrReplace(entity: Entity, value?: T): T
  get(entity: Entity): T
  getOrNull(entity: Entity): T | null
  getMutable(entity: Entity): T
  has(entity: Entity): boolean
  deleteFrom(entity: Entity): void
  onChange(entity: Entity, callback: (value: T | undefined) => void): void
  readonly _values: Map<Entity, T>
  readonly _clocks: Map<Entity, number>
  readonly _dirty: Map<Entity, Operation>
  readonly _sent: Map<Entity, Uint8Array>
  _forget(entity: Entity): void
  _notify(entity: Entity, value: T | undefined): void
}

export function createComponent<T = any>(spec: ComponentSpec<T>): Component<T> {
  const [componentName, componentId, codec, renderer = true] = spec
  const values = new Map<Entity, T>()
  const clocks = new Map<Entity, number>()
  const dirty = new Map<Entity, Operation>()
  const sent = new Map<Entity, Uint8Array>()
  const listeners = new Map<Entity, Array<(value: T | undefined) => void>>()
  const api: Component<T> = {
    componentName,
    componentId,
    codec,
    renderer,
    create(entity, value) {
      if (values.has(entity)) throw new Error(`${componentName} already exists on entity ${entity}`)
      return api.createOrReplace(entity, value)
    },
    createOrReplace(entity, value) {
      const next = value === undefined ? codec.create() : clone(value)
      values.set(entity, next)
      dirty.set(entity, 'put')
      return next
    },
    get(entity) {
      const value = values.get(entity)
      if (value === undefined) throw new Error(`${componentName} missing on entity ${entity}`)
      return value
    },
    getOrNull(entity) { return values.get(entity) ?? null },
    getMutable(entity) {
      const value = api.get(entity)
      dirty.set(entity, 'put')
      return value
    },
    has(entity) { return values.has(entity) },
    deleteFrom(entity) {
      if (!values.has(entity)) return
      values.delete(entity)
      dirty.set(entity, 'delete')
    },
    onChange(entity, callback) {
      const current = listeners.get(entity) ?? []
      current.push(callback)
      listeners.set(entity, current)
    },
    _values: values,
    _clocks: clocks,
    _dirty: dirty,
    _sent: sent,
    _forget(entity) {
      values.delete(entity)
      clocks.delete(entity)
      dirty.delete(entity)
      sent.delete(entity)
      listeners.delete(entity)
    },
    _notify(entity, value) {
      for (const callback of listeners.get(entity) ?? []) callback(value)
    }
  }
  return api
}
