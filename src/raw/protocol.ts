import { PBGltfContainer } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/gltf_container.gen.js'
import { PBGltfNodeModifiers } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/gltf_node_modifiers.gen.js'
import { PBMaterial } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/material.gen.js'
import { PBMeshCollider } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/mesh_collider.gen.js'
import { PBMeshRenderer } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/mesh_renderer.gen.js'
import { PBPointerEvents } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/pointer_events.gen.js'
import { PBPointerEventsResult } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/pointer_events_result.gen.js'
import { PBPointerLock } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/pointer_lock.gen.js'
import { PBRaycast } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/raycast.gen.js'
import { PBRaycastResult } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/raycast_result.gen.js'
import { PBUiBackground } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_background.gen.js'
import { PBUiCanvasInformation } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_canvas_information.gen.js'
import { PBUiInput } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_input.gen.js'
import { PBUiInputResult } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_input_result.gen.js'
import { PBUiText } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_text.gen.js'
import { PBUiTransform } from '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/ui_transform.gen.js'

export interface Codec<T = any> {
  encode(value: T): Uint8Array
  decode(data: Uint8Array): T
  create(): T
}

export type ComponentSpec<T = any> = readonly [string, number, Codec<T>, boolean?]

export interface CrdtMessage {
  type: number
  length: number
  offset: number
  entity: number
  component: number
  timestamp: number
  data: Uint8Array
}

interface GeneratedCodec<T = any> {
  encode(value: T): { finish(): Uint8Array }
  decode(data: Uint8Array): T
}

interface Vector3 { x: number; y: number; z: number }
interface Quaternion extends Vector3 { w: number }
interface TransformValue {
  position?: Vector3
  rotation?: Quaternion
  scale?: Vector3
  parent?: number
}

type MapField = { kind: 'int32' | 'int64' | 'string'; default?: number | string }
type MapFields = Record<string, MapField>
type MapValue = Record<string, any>

export const PUT_COMPONENT = 1
export const DELETE_COMPONENT = 2
export const DELETE_ENTITY = 3
export const APPEND_VALUE = 4
const GODOT_DELETE_COMPONENT_LENGTH = 28

export const IDS = Object.freeze({
  Transform: 1,
  Material: 1017,
  MeshRenderer: 1018,
  MeshCollider: 1019,
  GltfContainer: 1041,
  UiTransform: 1050,
  UiText: 1052,
  UiBackground: 1053,
  UiCanvasInformation: 1054,
  PointerEvents: 1062,
  PointerEventsResult: 1063,
  Raycast: 1067,
  RaycastResult: 1068,
  PointerLock: 1074,
  UiInput: 1093,
  UiInputResult: 1095,
  GltfNodeModifiers: 1099,
  BrickData: 3728684153
})

const BRICK_FIELDS = Object.freeze({
  brickId: { kind: 'int64' }, defIdx: { kind: 'int32' }, a0: { kind: 'int32' },
  b0: { kind: 'int32' }, ys0: { kind: 'int32' }, rotK: { kind: 'int32' },
  color: { kind: 'int32' }, thick: { kind: 'int32' }, by: { kind: 'string' },
  at: { kind: 'int64' }
}) as MapFields

function pb<T = any>(codec: GeneratedCodec<T>): Codec<T> {
  return {
    encode(value) { return codec.encode(value).finish() },
    decode(data) { return codec.decode(data) },
    create() { return codec.decode(new Uint8Array()) }
  }
}

const transformCodec: Codec<TransformValue> = {
  encode(value) {
    const data = new Uint8Array(44)
    const view = new DataView(data.buffer)
    const p = value.position ?? { x: 0, y: 0, z: 0 }
    const r = value.rotation ?? { x: 0, y: 0, z: 0, w: 1 }
    const s = value.scale ?? { x: 1, y: 1, z: 1 }
    const values = [p.x, p.y, p.z, r.x, r.y, r.z, r.w, s.x, s.y, s.z]
    for (let index = 0; index < values.length; index++) view.setFloat32(index * 4, Object.is(values[index], -0) ? 0 : values[index], true)
    view.setUint32(40, value.parent ?? 0, true)
    return data
  },
  decode(data) {
    if (data.byteLength !== 44) throw new Error(`invalid Transform payload: ${data.byteLength}`)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const f = (offset: number) => view.getFloat32(offset, true)
    return {
      position: { x: f(0), y: f(4), z: f(8) },
      rotation: { x: f(12), y: f(16), z: f(20), w: f(24) },
      scale: { x: f(28), y: f(32), z: f(36) },
      parent: view.getUint32(40, true)
    }
  },
  create() {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      parent: 0
    }
  }
}

export const BUILTIN_SPECS = Object.freeze([
  ['core::Transform', IDS.Transform, transformCodec],
  ['core::Material', IDS.Material, pb(PBMaterial)],
  ['core::MeshRenderer', IDS.MeshRenderer, pb(PBMeshRenderer)],
  ['core::MeshCollider', IDS.MeshCollider, pb(PBMeshCollider)],
  ['core::GltfContainer', IDS.GltfContainer, pb(PBGltfContainer)],
  ['core::UiTransform', IDS.UiTransform, pb(PBUiTransform)],
  ['core::UiText', IDS.UiText, pb(PBUiText)],
  ['core::UiBackground', IDS.UiBackground, pb(PBUiBackground)],
  ['core::UiCanvasInformation', IDS.UiCanvasInformation, pb(PBUiCanvasInformation)],
  ['core::PointerEvents', IDS.PointerEvents, pb(PBPointerEvents)],
  ['core::PointerEventsResult', IDS.PointerEventsResult, pb(PBPointerEventsResult)],
  ['core::Raycast', IDS.Raycast, pb(PBRaycast)],
  ['core::RaycastResult', IDS.RaycastResult, pb(PBRaycastResult)],
  ['core::PointerLock', IDS.PointerLock, pb(PBPointerLock)],
  ['core::UiInput', IDS.UiInput, pb(PBUiInput)],
  ['core::UiInputResult', IDS.UiInputResult, pb(PBUiInputResult)],
  ['core::GltfNodeModifiers', IDS.GltfNodeModifiers, pb(PBGltfNodeModifiers)],
  ['hexabricks::brick', IDS.BrickData, mapCodec(BRICK_FIELDS), false]
]) as unknown as readonly ComponentSpec[]

function utf8Encode(value: unknown): Uint8Array {
  const text = String(value)
  const bytes: number[] = []
  for (let index = 0; index < text.length; index++) {
    let point = text.charCodeAt(index)
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = text.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00
        index++
      } else point = 0xfffd
    } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd
    if (point < 0x80) bytes.push(point)
    else if (point < 0x800) bytes.push(0xc0 | point >> 6, 0x80 | point & 0x3f)
    else if (point < 0x10000)
      bytes.push(0xe0 | point >> 12, 0x80 | point >> 6 & 0x3f, 0x80 | point & 0x3f)
    else
      bytes.push(0xf0 | point >> 18, 0x80 | point >> 12 & 0x3f, 0x80 | point >> 6 & 0x3f, 0x80 | point & 0x3f)
  }
  return new Uint8Array(bytes)
}

function utf8Decode(data: Uint8Array): string {
  let text = ''
  for (let index = 0; index < data.byteLength;) {
    const first = data[index++]
    let point: number
    let width: number | undefined
    let minimum: number | undefined
    if (first < 0x80) point = first
    else if (first >= 0xc2 && first <= 0xdf) {
      point = first & 0x1f
      width = 1
      minimum = 0x80
    } else if (first >= 0xe0 && first <= 0xef) {
      point = first & 0x0f
      width = 2
      minimum = 0x800
    } else if (first >= 0xf0 && first <= 0xf4) {
      point = first & 7
      width = 3
      minimum = 0x10000
    } else point = 0xfffd
    if (width !== undefined) {
      let cursor = index
      while (cursor < index + width && cursor < data.byteLength && (data[cursor] & 0xc0) === 0x80)
        point = point << 6 | data[cursor++] & 0x3f
      if (cursor !== index + width) point = 0xfffd
      else {
        index = cursor
        if (point < minimum! || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) point = 0xfffd
      }
    }
    if (point <= 0xffff) text += String.fromCharCode(point)
    else {
      point -= 0x10000
      text += String.fromCharCode(0xd800 | point >> 10, 0xdc00 | point & 0x3ff)
    }
  }
  return text
}

export function mapCodec<T extends MapValue = MapValue>(fields: MapFields): Codec<T> {
  const entries = Object.entries(fields)
  return {
    encode(value) {
      let length = 0
      const strings: Record<string, Uint8Array> = {}
      for (const [key, field] of entries) {
        if (field.kind === 'string') {
          strings[key] = utf8Encode(value[key] ?? field.default ?? '')
          length += 4 + strings[key].byteLength
        } else length += field.kind === 'int64' ? 8 : 4
      }
      const data = new Uint8Array(length)
      const view = new DataView(data.buffer)
      let offset = 0
      for (const [key, field] of entries) {
        const item = value[key] ?? field.default
        if (field.kind === 'string') {
          const encoded = strings[key]
          view.setUint32(offset, encoded.byteLength, true)
          data.set(encoded, offset + 4)
          offset += 4 + encoded.byteLength
        } else if (field.kind === 'int64') {
          view.setBigInt64(offset, BigInt(item ?? 0), true)
          offset += 8
        } else {
          view.setInt32(offset, Number(item ?? 0), true)
          offset += 4
        }
      }
      return data
    },
    decode(data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const value: MapValue = {}
      let offset = 0
      for (const [key, field] of entries) {
        if (field.kind === 'string') {
          if (offset + 4 > data.byteLength) throw new Error(`truncated map string ${key}`)
          const length = view.getUint32(offset, true)
          offset += 4
          if (offset + length > data.byteLength) throw new Error(`truncated map string data ${key}`)
          value[key] = utf8Decode(data.subarray(offset, offset + length))
          offset += length
        } else if (field.kind === 'int64') {
          if (offset + 8 > data.byteLength) throw new Error(`truncated map int64 ${key}`)
          value[key] = Number(view.getBigInt64(offset, true))
          offset += 8
        } else {
          if (offset + 4 > data.byteLength) throw new Error(`truncated map int32 ${key}`)
          value[key] = view.getInt32(offset, true)
          offset += 4
        }
      }
      if (offset !== data.byteLength) throw new Error(`map payload has ${data.byteLength - offset} trailing bytes`)
      return value as T
    },
    create() {
      return Object.fromEntries(entries.map(([key, field]) => [key, field.default ?? (field.kind === 'string' ? '' : 0)])) as T
    }
  }
}

export class CrdtWriter {
  private data: Uint8Array
  private view: DataView
  private length = 0

  constructor(capacity = 4096) {
    this.data = new Uint8Array(Math.max(capacity, 32))
    this.view = new DataView(this.data.buffer)
  }

  private reserve(size: number): void {
    if (this.length + size <= this.data.byteLength) return
    let capacity = this.data.byteLength
    while (capacity < this.length + size) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.data.subarray(0, this.length))
    this.data = next
    this.view = new DataView(next.buffer)
  }

  private header(size: number, ...words: number[]): number {
    this.reserve(size)
    const at = this.length
    this.view.setUint32(at, size, true)
    words.forEach((word, index) => this.view.setUint32(at + 4 + index * 4, word, true))
    this.length += size
    return at
  }

  put(entity: number, component: number, timestamp: number, payload: Uint8Array, type = PUT_COMPONENT): void {
    const at = this.header(24 + payload.byteLength, type, entity, component, timestamp, payload.byteLength)
    this.data.set(payload, at + 24)
  }

  deleteComponent(entity: number, component: number, timestamp: number): void {
    this.header(20, DELETE_COMPONENT, entity, component, timestamp)
  }

  deleteEntity(entity: number): void {
    this.header(12, DELETE_ENTITY, entity)
  }

  take(): Uint8Array {
    const result = this.data.slice(0, this.length)
    this.length = 0
    return result
  }
}

export function parseCrdt(data: Uint8Array | ArrayBuffer): CrdtMessage[] {
  const bytes: Uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const messages: CrdtMessage[] = []
  for (let offset = 0; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error(`truncated CRDT header at ${offset}`)
    let length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    // The Godot explorer declares its PutComponent header size (28) on DeleteComponent messages
    // but writes the 20-byte spec header, which Unity and @dcl/ecs also write. The reference
    // decoder consumes the three fields regardless of the declared length; do the same.
    if (type === DELETE_COMPONENT && length === GODOT_DELETE_COMPONENT_LENGTH) length = 20
    if (length < 8 || offset + length > bytes.byteLength) throw new Error(`invalid CRDT length ${length} at ${offset}`)
    const message = { type, length, offset } as CrdtMessage
    if (type === DELETE_ENTITY) {
      if (length !== 12) throw new Error(`invalid delete-entity length ${length}`)
      message.entity = view.getUint32(offset + 8, true)
    } else if (type === DELETE_COMPONENT) {
      if (length !== 20) throw new Error(`invalid delete-component length ${length}`)
      message.entity = view.getUint32(offset + 8, true)
      message.component = view.getUint32(offset + 12, true)
      message.timestamp = view.getUint32(offset + 16, true)
    } else if (type === PUT_COMPONENT || type === APPEND_VALUE) {
      if (length < 24) throw new Error(`invalid component length ${length}`)
      const payloadLength = view.getUint32(offset + 20, true)
      if (payloadLength !== length - 24) throw new Error(`invalid payload length ${payloadLength}`)
      message.entity = view.getUint32(offset + 8, true)
      message.component = view.getUint32(offset + 12, true)
      message.timestamp = view.getUint32(offset + 16, true)
      message.data = bytes.subarray(offset + 24, offset + length)
    } else throw new Error(`unsupported CRDT message type ${type}`)
    messages.push(message)
    offset += length
  }
  return messages
}

export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Uint8Array) return value.slice() as T
  if (Array.isArray(value)) return value.map(clone) as T
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) copy[key] = clone(source[key])
  return copy as T
}

export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const ak = Object.keys(left)
  const bk = Object.keys(right)
  if (ak.length !== bk.length) return false
  for (const key of ak) if (!Object.hasOwn(right, key) || !equal(left[key], right[key])) return false
  return true
}
