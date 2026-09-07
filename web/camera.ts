export type Vec3 = [number, number, number]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export class Camera {
  target: Vec3 = [0, 0, 0]
  yaw = -0.55
  elevation = 0.92
  span = 26
  width = 1
  height = 1
  get right(): Vec3 { return [Math.cos(this.yaw), 0, -Math.sin(this.yaw)] }
  get up(): Vec3 { return [-Math.sin(this.yaw) * Math.sin(this.elevation), Math.cos(this.elevation), -Math.cos(this.yaw) * Math.sin(this.elevation)] }
  get back(): Vec3 { return [Math.sin(this.yaw) * Math.cos(this.elevation), Math.sin(this.elevation), Math.cos(this.yaw) * Math.cos(this.elevation)] }
  get halfHeight() { return this.span / 2 }
  get halfWidth() { return this.halfHeight * this.width / this.height }
  pan(dx: number, dy: number) {
    const unit = this.span / this.height
    const right = this.right
    const groundUp: Vec3 = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)]
    this.target = add(this.target, add(scale(right, -dx * unit), scale(groundUp, dy * unit / Math.sin(this.elevation))))
    this.target[0] = clamp(this.target[0], -48, 48)
    this.target[2] = clamp(this.target[2], -32, 32)
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.007
    this.elevation = clamp(this.elevation + dy * 0.005, 0.3, Math.PI / 2)
  }
  zoom(factor: number) { this.span = clamp(this.span * factor, 5, 125) }
  ray(x: number, y: number): { origin: Vec3; direction: Vec3 } {
    const offset = add(scale(this.right, (2 * x / this.width - 1) * this.halfWidth), scale(this.up, (1 - 2 * y / this.height) * this.halfHeight))
    return { origin: add(add(this.target, offset), scale(this.back, 150)), direction: scale(this.back, -1) }
  }
  project(p: Vec3): [number, number] {
    const d = sub(p, this.target)
    return [(dot(d, this.right) / this.halfWidth + 1) * this.width / 2, (1 - dot(d, this.up) / this.halfHeight) * this.height / 2]
  }
  uniforms(time: number): Float32Array<ArrayBuffer> {
    return new Float32Array([...this.right, 1 / this.halfWidth, ...this.up, 1 / this.halfHeight, ...this.back, 0, ...this.target, time])
  }
}
