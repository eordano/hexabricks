export interface Vector3Value { x: number; y: number; z: number }
export interface QuaternionValue extends Vector3Value { w: number }
export interface Color3Value { r: number; g: number; b: number }
export interface Color4Value extends Color3Value { a: number }

export const Vector3 = {
  create: (x = 0, y = 0, z = 0): Vector3Value => ({ x, y, z }),
  Zero: (): Vector3Value => ({ x: 0, y: 0, z: 0 }),
  Forward: (): Vector3Value => ({ x: 0, y: 0, z: 1 })
}

export const Quaternion = {
  fromEulerDegrees(x: number, y: number, z: number): QuaternionValue {
    const pitch = x * Math.PI / 360
    const yaw = y * Math.PI / 360
    const roll = z * Math.PI / 360
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const cr = Math.cos(roll), sr = Math.sin(roll)
    return {
      x: cy * sp * cr + sy * cp * sr,
      y: sy * cp * cr - cy * sp * sr,
      z: cy * cp * sr - sy * sp * cr,
      w: cy * cp * cr + sy * sp * sr
    }
  }
}

export const Color3 = {
  White: (): Color3Value => ({ r: 1, g: 1, b: 1 })
}

export const Color4 = {
  create: (r = 0, g = 0, b = 0, a = 1): Color4Value => ({ r, g, b, a })
}
