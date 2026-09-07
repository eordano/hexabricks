import type { Page } from '@playwright/test'

// Linux Chromium's screenshot compositor can omit a correctly rendered WebGPU
// canvas. Test actual swapchain pixels instead of mistaking DOM chrome for GPU output.
export async function installGPUReadback(page: Page) {
  await page.addInitScript(() => {
    let device: GPUDevice, texture: GPUTexture
    let pending: ((colors: number) => void) | undefined
    const configure = GPUCanvasContext.prototype.configure
    GPUCanvasContext.prototype.configure = function(options) {
      device = options.device
      return configure.call(this, { ...options, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    }
    const getTexture = GPUCanvasContext.prototype.getCurrentTexture
    GPUCanvasContext.prototype.getCurrentTexture = function() { texture = getTexture.call(this); return texture }
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function(commands) {
      submit.call(this, commands)
      if (!pending || !texture) return
      const done = pending; pending = undefined
      const width = texture.width, height = texture.height, stride = Math.ceil(width * 4 / 256) * 256
      const buffer = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, { width, height })
      submit.call(this, [encoder.finish()])
      void buffer.mapAsync(GPUMapMode.READ).then(() => {
        const pixels = new Uint8Array(buffer.getMappedRange()), colors = new Set<number>()
        for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
          const i = y * stride + x * 4
          colors.add(pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2])
        }
        buffer.unmap(); buffer.destroy(); done(colors.size)
      })
    }
    Object.assign(window, { captureGPUColors: () => new Promise<number>(resolve => { pending = resolve; document.dispatchEvent(new Event('visibilitychange')) }) })
  })
}
