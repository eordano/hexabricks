import { createRawEngine } from '../engine.ts'
import { IDS } from '../protocol.ts'
import type { Component } from '../component-store.ts'

type Entity = number
type Value = Record<string, any>

export const __raw = createRawEngine()
export const engine = __raw.engine
export const inputSystem = __raw.inputSystem
export const raycastSystem = __raw.raycastSystem

function at(id: number): Component<any> { return __raw.getComponent(id) }

function withTransformDefaults(base: Component<any>) {
  const rawCreate = base.create.bind(base)
  const rawReplace = base.createOrReplace.bind(base)
  const extend = (value: Value = {}): Value => ({ ...base.codec.create(), ...value })
  return {
    ...base,
    create: (entity: Entity, value?: Value) => rawCreate(entity, extend(value)),
    createOrReplace: (entity: Entity, value?: Value) => rawReplace(entity, extend(value))
  }
}

export const Transform = withTransformDefaults(at(IDS.Transform))
export const GltfContainer = at(IDS.GltfContainer)
export const GltfNodeModifiers = at(IDS.GltfNodeModifiers)
export const PointerLock = at(IDS.PointerLock)

const material = at(IDS.Material)
export const Material = {
  ...material,
  Texture: {
    Common: (texture: Value): Value => ({ tex: { $case: 'texture', texture } })
  },
  setPbrMaterial(entity: Entity, value: Value): void {
    material.createOrReplace(entity, { material: { $case: 'pbr', pbr: value } })
  }
}

const meshRenderer = at(IDS.MeshRenderer)
export const MeshRenderer = {
  ...meshRenderer,
  setPlane(entity: Entity, uvs: number[] = []): void {
    meshRenderer.createOrReplace(entity, { mesh: { $case: 'plane', plane: { uvs } } })
  }
}

const meshCollider = at(IDS.MeshCollider)
export const MeshCollider = {
  ...meshCollider,
  setPlane(entity: Entity, collisionMask: number): void {
    meshCollider.createOrReplace(entity, { mesh: { $case: 'plane', plane: {} }, collisionMask })
  }
}

export const ColliderLayer = Object.freeze({ CL_NONE: 0, CL_POINTER: 1, CL_PHYSICS: 2 })
export const MaterialTransparencyMode = Object.freeze({ MTM_ALPHA_BLEND: 2 })
export const TextureWrapMode = Object.freeze({ TWM_REPEAT: 0 })
export const RaycastQueryType = Object.freeze({ RQT_QUERY_ALL: 1 })
export const PointerEventType = Object.freeze({ PET_UP: 0, PET_DOWN: 1 })
export const InputAction = Object.freeze({
  IA_POINTER: 0, IA_PRIMARY: 1, IA_SECONDARY: 2,
  IA_ACTION_3: 10, IA_ACTION_4: 11,
  IA_ACTION_5: 12, IA_ACTION_6: 13
})
