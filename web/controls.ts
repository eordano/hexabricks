import type { Camera } from './camera.ts'

export interface ControlHooks {
  camera(): void
  aim(x: number, y: number, touch: boolean): void
  apply(): void
  orbit(): boolean
}
export function attachControls(canvas: HTMLCanvasElement, camera: Camera, hooks: ControlHooks) {
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; moved: boolean; button: number; touch: boolean }>()
  let multi = false
  const local = (event: PointerEvent) => { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('pointerdown', event => {
    if (event.button > 2) return
    canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId)
    const { x, y } = local(event)
    pointers.set(event.pointerId, { x, y, startX: x, startY: y, moved: false, button: event.button, touch: event.pointerType !== 'mouse' })
    if (pointers.size > 1) { multi = true; for (const p of pointers.values()) p.moved = true }
  })
  canvas.addEventListener('pointermove', event => {
    const { x, y } = local(event), p = pointers.get(event.pointerId)
    if (!p) { if (event.pointerType === 'mouse') hooks.aim(x, y, false); return }
    const dx = x - p.x, dy = y - p.y
    if (Math.hypot(x - p.startX, y - p.startY) > 6) p.moved = true
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)![1]
      const oldDistance = Math.hypot(p.x - other.x, p.y - other.y), distance = Math.hypot(x - other.x, y - other.y)
      if (oldDistance > 10 && distance > 10) camera.zoom(oldDistance / distance)
      camera.pan(dx / 2, dy / 2); hooks.camera()
    } else if (p.moved) {
      if (hooks.orbit() || p.button === 2 || event.altKey) camera.orbit(dx, dy)
      else camera.pan(dx, dy)
      hooks.camera()
    }
    p.x = x; p.y = y
    canvas.classList.toggle('dragging', p.moved)
  })
  const finish = (event: PointerEvent, canceled: boolean) => {
    const p = pointers.get(event.pointerId)
    if (!p) return
    pointers.delete(event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (!canceled && !multi && !p.moved && p.button === 0) {
      const { x, y } = local(event)
      hooks.aim(x, y, p.touch)
      if (!p.touch) hooks.apply()
    }
    if (!pointers.size) { multi = false; canvas.classList.remove('dragging') }
  }
  canvas.addEventListener('pointerup', e => finish(e, false))
  canvas.addEventListener('pointercancel', e => finish(e, true))
  canvas.addEventListener('lostpointercapture', e => finish(e, true))
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    camera.zoom(Math.exp(Math.max(-150, Math.min(150, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * 0.002))
    hooks.camera()
  }, { passive: false })
}
