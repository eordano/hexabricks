import { Camera } from './camera.ts'
import { brickGeometry } from './geometry.ts'
import { PALETTE, rgb } from './palette.ts'
import { vertexPos, HSUB } from '../src/hexbrick-core.ts'
import { BRICK_BASE_Y, THICK_GAP, FLOOR_W, FLOOR_D, BOARD_LIFT } from '../src/scene-config.ts'
import type { BrickWireRecord } from '../src/brick-wire.ts'

const palette = (key: 'base' | 'glow') => PALETTE.map(p => `vec3f(${rgb(p[key]).join(',')})`).join(',')
const shader = /* wgsl */ `
struct Camera { right: vec4f, up: vec4f, back: vec4f, focus: vec4f }
@group(0) @binding(0) var<uniform> camera: Camera;
fn project(p: vec3f) -> vec4f {
  let d = p - camera.focus.xyz;
  return vec4f(dot(d, camera.right.xyz) * camera.right.w, dot(d, camera.up.xyz) * camera.up.w, (150.0 - dot(d, camera.back.xyz)) / 400.0, 1.0);
}
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) material: vec2f
}
@vertex fn brickVertex(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) placement: vec4f, @location(3) appearance: vec4f) -> VertexOut {
  let c = appearance.x; let s = appearance.y;
  let world = vec3f(p.x*c-p.z*s, p.y*placement.w, p.x*s+p.z*c) + placement.xyz;
  var out: VertexOut;
  out.position = project(world);
  out.world = world;
  out.normal = vec3f(n.x*c-n.z*s, n.y, n.x*s+n.z*c);
  out.local = p;
  out.material = appearance.zw;
  return out;
}
@fragment fn brickFragment(in: VertexOut) -> @location(0) vec4f {
  let bases = array<vec3f,8>(${palette('base')});
  let glows = array<vec3f,8>(${palette('glow')});
  let index = u32(in.material.x);
  let light = 0.65 + 0.35 * max(dot(in.normal, normalize(vec3f(-0.4, 0.9, 0.3))), 0.0);
  let rim = smoothstep(0.815, 0.84, in.local.y) * (1.0-abs(in.normal.y));
  var color = mix(bases[index] * light, glows[index] * 0.92, rim);
  let state = in.material.y;
  if (state > 0.5) {
    let valid = select(vec3f(1.0, 0.22, 0.34), vec3f(0.47, 0.96, 0.82), state < 1.5);
    color = mix(color, valid, 0.63);
    return vec4f(color, 0.68);
  }
  // Gentle contact shading under the luminous band, with no postprocessing cost.
  color *= 0.86 + 0.14 * smoothstep(0.0, 0.3, in.local.y);
  return vec4f(color, 1.0);
}
struct FloorOut { @builtin(position) position: vec4f, @location(0) world: vec3f }
@vertex fn floorVertex(@builtin(vertex_index) i: u32) -> FloorOut {
  let p = array<vec2f,6>(vec2f(-48,-32),vec2f(48,-32),vec2f(48,32),vec2f(-48,-32),vec2f(48,32),vec2f(-48,32));
  var out: FloorOut;
  out.world = vec3f(p[i].x, ${BOARD_LIFT}, p[i].y);
  out.position = project(out.world);
  return out;
}
@fragment fn floorFragment(in: FloorOut) -> @location(0) vec4f {
  let p = in.world.xz;
  let rf = p.y / 1.5; let qf = p.x / 1.7320508 - rf / 2.0;
  var q = round(qf); var r = round(rf); let y = round(-qf-rf);
  let delta = abs(vec3f(q-qf, r-rf, y+qf+rf));
  if (delta.x > delta.y && delta.x > delta.z) { q = -r-y; } else if (delta.y > delta.z) { r = -q-y; }
  let offset = p-vec2f(1.7320508*(q+r/2.0),1.5*r);
  let edge = max(0.0, 0.8660254-max(abs(offset.x),max(abs(offset.x*0.5+offset.y*0.8660254),abs(-offset.x*0.5+offset.y*0.8660254))));
  let aa = max(fwidth(edge),0.008);
  let line = 1.0-smoothstep(0.018,0.018+aa,edge);
  let glow = pow(max(0.0,1.0-edge/0.22),3.0);
  let distanceFade = clamp(0.08/aa,0.15,1.0);
  var color = vec3f(0.027,0.12,0.135) + vec3f(0.032,0.14,0.145)*glow + vec3f(0.15,0.43,0.4)*line*distanceFade;
  let border = min(48.0-abs(p.x),32.0-abs(p.y));
  color = mix(color,vec3f(0.39,0.88,0.77),1.0-smoothstep(0.04,0.04+aa,border));
  return vec4f(color,1.0);
}
`

interface Batch { vertex: GPUBuffer; vertices: number; instances: GPUBuffer; capacity: number; count: number }
export interface Ghost { record: BrickWireRecord; valid: boolean }

export class Renderer {
  readonly camera = new Camera()
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private solid!: GPURenderPipeline
  private transparent!: GPURenderPipeline
  private floor!: GPURenderPipeline
  private cameraBuffer!: GPUBuffer
  private bindGroup!: GPUBindGroup
  private batches: Batch[] = []
  private ghostBuffer!: GPUBuffer
  private depth?: GPUTexture
  private color?: GPUTexture
  private format!: GPUTextureFormat
  private frame = 0
  private ghost: Ghost | null = null
  private dead = false
  readonly sampleCount = 4

  constructor(readonly canvas: HTMLCanvasElement, private fail: (message: string) => void) {}

  async init() {
    if (!isSecureContext) throw new Error('WebGPU needs a secure connection. Open this page over HTTPS, or use localhost on this computer.')
    if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser. Try a browser and device with WebGPU enabled, then open this page again.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' })
    if (!adapter) throw new Error('This browser could not access a WebGPU graphics adapter. Enable hardware acceleration or try another device.')
    this.device = await adapter.requestDevice()
    this.device.lost.then(info => { if (!this.dead) { this.dead = true; this.fail(`Graphics connection lost. Reload to reconnect. ${info.message}`) } })
    this.device.addEventListener('uncapturederror', event => { console.error(event.error.message); this.dead = true; this.fail('The graphics renderer stopped. Reload to reconnect to the world.') })
    const context = this.canvas.getContext('webgpu')
    if (!context) throw new Error('Could not create a WebGPU canvas. Reload or try another browser.')
    this.context = context
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })
    const module = this.device.createShaderModule({ label: 'Hexabricks materials and hex floor', code: shader })
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter(m => m.type === 'error')
    if (errors.length) throw new Error(errors.map(m => m.message).join('\n'))
    const layout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] })
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const buffers: GPUVertexBufferLayout[] = [
      { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
      { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }] }
    ]
    const blend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
    const pipeline = (ghost: boolean) => this.device.createRenderPipelineAsync({
      label: ghost ? 'Placement preview' : 'Instanced bricks', layout: pipelineLayout,
      vertex: { module, entryPoint: 'brickVertex', buffers },
      fragment: { module, entryPoint: 'brickFragment', targets: [{ format: this.format, ...(ghost ? { blend } : {}) }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: !ghost, depthCompare: 'less-equal' },
      multisample: { count: this.sampleCount }
    })
    ;[this.solid, this.transparent, this.floor] = await Promise.all([
      pipeline(false), pipeline(true),
      this.device.createRenderPipelineAsync({
        label: 'Analytic hex floor', layout: pipelineLayout,
        vertex: { module, entryPoint: 'floorVertex' }, fragment: { module, entryPoint: 'floorFragment', targets: [{ format: this.format }] },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: this.sampleCount }
      })
    ])
    this.cameraBuffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.bindGroup = this.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }] })
    this.batches = Array.from({ length: 8 }, (_, i) => {
      const data = brickGeometry(i), vertex = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(vertex, 0, data)
      return { vertex, vertices: data.length / 6, instances: this.instanceBuffer(1), capacity: 1, count: 0 }
    })
    this.ghostBuffer = this.instanceBuffer(1)
    this.resize()
  }

  private instanceBuffer(capacity: number) { return this.device.createBuffer({ size: capacity * 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) }
  private instance(record: BrickWireRecord, flag = 0): number[] {
    const p = vertexPos(record.a0, record.b0), angle = record.rotK * Math.PI / 3
    return [p.x, record.ys0 * HSUB + BRICK_BASE_Y + (flag ? 0.006 : 0), p.z, record.thick * HSUB - THICK_GAP, Math.cos(angle), Math.sin(angle), record.color, flag]
  }
  setRecords(records: Iterable<BrickWireRecord>) {
    if (this.dead) return
    const groups: number[][] = Array.from({ length: 8 }, () => [])
    for (const record of records) groups[record.defIdx].push(...this.instance(record))
    groups.forEach((data, i) => {
      const batch = this.batches[i]
      batch.count = data.length / 8
      if (batch.count > batch.capacity) {
        batch.instances.destroy(); batch.capacity = Math.max(batch.count, batch.capacity * 2)
        batch.instances = this.instanceBuffer(batch.capacity)
      }
      if (data.length) this.device.queue.writeBuffer(batch.instances, 0, new Float32Array(data))
    })
    this.invalidate()
  }
  setGhost(ghost: Ghost | null) {
    this.ghost = ghost
    if (ghost) this.device.queue.writeBuffer(this.ghostBuffer, 0, new Float32Array(this.instance(ghost.record, ghost.valid ? 1 : 2)))
    this.invalidate()
  }
  resize() {
    if (this.dead) return
    const { width, height } = this.canvas.getBoundingClientRect()
    this.camera.width = Math.max(1, width); this.camera.height = Math.max(1, height)
    const ratio = Math.min(devicePixelRatio || 1, 1.75, Math.sqrt(3_000_000 / (width * height)))
    const w = Math.max(1, Math.min(this.device.limits.maxTextureDimension2D, Math.round(width * ratio)))
    const h = Math.max(1, Math.min(this.device.limits.maxTextureDimension2D, Math.round(height * ratio)))
    if (this.canvas.width !== w || this.canvas.height !== h || !this.depth) {
      this.canvas.width = w; this.canvas.height = h
      this.depth?.destroy(); this.color?.destroy()
      this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: this.sampleCount, usage: GPUTextureUsage.RENDER_ATTACHMENT })
      this.color = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: this.sampleCount, usage: GPUTextureUsage.RENDER_ATTACHMENT })
    }
    this.invalidate()
  }
  invalidate() { if (!this.frame && !this.dead) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() }) }
  private draw() {
    if (this.dead || !this.depth || !this.color || document.hidden) return
    this.device.queue.writeBuffer(this.cameraBuffer, 0, this.camera.uniforms(performance.now() / 1000))
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.color.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: { r: 0.035, g: 0.051, b: 0.065, a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
    })
    pass.setBindGroup(0, this.bindGroup)
    pass.setPipeline(this.floor); pass.draw(6)
    pass.setPipeline(this.solid)
    for (const batch of this.batches) {
      if (!batch.count) continue
      pass.setVertexBuffer(0, batch.vertex); pass.setVertexBuffer(1, batch.instances); pass.draw(batch.vertices, batch.count)
    }
    if (this.ghost) {
      const batch = this.batches[this.ghost.record.defIdx]
      pass.setPipeline(this.transparent); pass.setVertexBuffer(0, batch.vertex); pass.setVertexBuffer(1, this.ghostBuffer); pass.draw(batch.vertices)
    }
    pass.end(); this.device.queue.submit([encoder.finish()])
  }
  dispose() {
    this.dead = true; cancelAnimationFrame(this.frame)
    this.depth?.destroy(); this.color?.destroy(); this.device?.destroy()
  }
}
