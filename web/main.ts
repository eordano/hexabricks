import './styles.css'
import { Renderer, type Ghost } from './renderer.ts'
import { World } from './world.ts'
import { attachControls } from './controls.ts'
import { pick, placementTarget, type Hit } from './geometry.ts'
import { PALETTE } from './palette.ts'
import { outlinePts, SHAPES, vertexPos, type PlacementResult, ELEMS, ORDER, vclass } from '../src/hexbrick-core.ts'
import { BLOCK_HEIGHTS } from '../src/scene-config.ts'
import { createGenesisRelay, type GenesisRelay } from '../src/genesis-relay.ts'

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const button = (id: string) => $<HTMLButtonElement>(id)
const icons: { [key: string]: string } = {
  brick: '<path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9"/>',
  paint: '<path d="m14 6 4-4 4 4-9 9-4-4Z"/><path d="M9 13c-3-2-6 0-6 3 0 2-1 4-2 5 6 1 11-2 8-8Z"/>',
  erase: '<path d="m3 14 9-10a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 8H9l-6-5a2 2 0 0 1 0-2Z"/><path d="m8 9 9 9M13 21h9"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14" transform="translate(0 -2)"/>',
  rotate: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
  home: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><path d="M12 6v12"/><circle cx="12" cy="12" r="3"/>',
  top: '<path d="M4 4h16v16H4ZM4 12h16M12 4v16"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01"/>',
  'cloud-check': '<path d="M6 18a5 5 0 0 1-.8-9.9A7 7 0 0 1 19 9a4.5 4.5 0 0 1 1 8.6"/><path d="m9 17 3 3 5-6"/>',
  'cloud-sync': '<path d="M6 18a5 5 0 0 1-.8-9.9A7 7 0 0 1 19 9a4.5 4.5 0 0 1 1 8.6"/><path d="M12 21V12m-4 4 4-4 4 4"/>',
  'cloud-off': '<path d="M6 18a5 5 0 0 1-.8-9.9M8 5a7 7 0 0 1 11 4 4.5 4.5 0 0 1 2 8M3 3l18 18M10 18h5"/>',
  pan: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>'
}
function setIcon(el: HTMLElement, name: string) { el.dataset.icon = name; el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? ''}</svg>` }
document.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => setIcon(el, el.dataset.icon!))
document.querySelectorAll<HTMLButtonElement>('button[aria-label]:not([title])').forEach(b => b.title = b.getAttribute('aria-label')!)
const names = ['Hexagon', 'Half', 'Rhombus', 'Wedge', 'Bullet', 'Bar', 'Corner', 'Corner+']
const state = { shape: 0, color: 0, height: 2, rotation: 0, mode: 'place', orbit: false, touch: matchMedia('(pointer: coarse)').matches, aimed: false, ready: false, status: 'connecting', candidate: 0 }
const canvas = $<HTMLCanvasElement>('#world')
let renderer: Renderer
let relay: GenesisRelay
let world: World
let hit: Hit | null = null
let ghost: Ghost | null = null
let resolved: PlacementResult | null = null
let aimX = innerWidth / 2, aimY = innerHeight * 0.43
let refreshFrame = 0, timer = 0, toastTimer = 0, lastApply = 0
let pendingStatus = ''
function storageGet(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function storageSet(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Private mode still works for the current session. */ } }
const actor = storageGet('hexabricks.browser.actor') || `web-${[...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('')}`
storageSet('hexabricks.browser.actor', actor)

function toast(message: string, icon?: string) {
  clearTimeout(toastTimer)
  const el = $('#toast'); el.replaceChildren(); el.classList.toggle('symbol-toast', !!icon)
  const label = document.createElement('span'); label.textContent = message
  if (icon) { setIcon(el, icon); label.className = 'sr-only'; el.title = message } else el.removeAttribute('title')
  el.append(label); el.hidden = false
  toastTimer = window.setTimeout(() => { $('#toast').hidden = true }, 3200)
}
function fail(message: string) {
  $('#loading').hidden = true; $('#error-panel').hidden = false; $('#error-message').textContent = message
  document.body.classList.add('failed'); button('#apply').disabled = true
  $('#connection-text').textContent = 'Renderer unavailable'
  $('#connection').dataset.state = 'offline'; setIcon($('#connection-icon'), 'cloud-off')
  $('#pending-count').hidden = true
  button('#connection-details').title = 'Renderer unavailable'
  button('#reload').focus()
}
button('#reload').onclick = () => location.reload()
function setHelp(open: boolean) {
  $('#help-panel').hidden = !open
  for (const id of ['#help-toggle', '#connection-details']) button(id).setAttribute('aria-expanded', String(open))
  if (!open) button('#help-toggle').focus()
}
button('#help-toggle').onclick = () => setHelp($('#help-panel').hidden)
button('#connection-details').onclick = () => setHelp($('#help-panel').hidden)
button('#help-close').onclick = () => { setHelp(false); canvas.focus() }

function selected(container: string, value: number) {
  document.querySelectorAll<HTMLButtonElement>(`${container} button`).forEach((b, i) => {
    b.classList.toggle('selected', i === value); b.setAttribute('aria-pressed', String(i === value))
    if (i === value) b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
function renderSelection() {
  selected('#shapes', state.shape); selected('#colors', state.color); selected('#heights', BLOCK_HEIGHTS.indexOf(state.height))
  $('#selection-name').textContent = state.mode === 'delete' ? 'Remove a brick' : state.mode === 'paint' ? 'Paint a brick' : names[state.shape]
  $('#selection-detail').textContent = `${PALETTE[state.color].name} · ${state.height / 2}× high`
  $('#rotation-label').textContent = `${state.rotation * 60}°`
  const action = state.mode === 'place' ? 'Place brick' : state.mode === 'paint' ? 'Paint brick' : 'Remove brick'
  $('#apply-label').textContent = action
  button('#apply').title = `${action} (E)`
  button('#rotate').setAttribute('aria-label', `Rotate brick (${state.rotation * 60} degrees)`)
  setIcon($('#apply-icon'), state.mode === 'place' ? 'plus' : state.mode === 'paint' ? 'paint' : 'erase')
  button('#rotate').disabled = state.mode !== 'place'
  document.querySelectorAll<HTMLButtonElement>('#shapes button, #heights button').forEach(b => b.disabled = state.mode !== 'place')
  document.querySelectorAll<HTMLButtonElement>('#colors button').forEach(b => b.disabled = state.mode === 'delete')
  updateAim()
}
names.forEach((name, index) => {
  const points = outlinePts(index, 0)
  const xs = points.map(p => p.x), zs = points.map(p => p.z)
  const minX = Math.min(...xs), minZ = Math.min(...zs), w = Math.max(...xs) - minX, h = Math.max(...zs) - minZ, span = Math.max(w, h) + 0.4
  const b = document.createElement('button'); b.className = 'shape-button'; b.setAttribute('aria-label', name); b.title = name
  b.innerHTML = `<svg viewBox="${minX - (span - w) / 2} ${minZ - (span - h) / 2} ${span} ${span}" aria-hidden="true"><polygon points="${points.map(p => `${p.x},${p.z}`).join(' ')}"/></svg>`
  b.onclick = () => { state.shape = index; state.candidate = 0; renderSelection() }; $('#shapes').append(b)
})
PALETTE.forEach((color, index) => {
  const b = document.createElement('button'); b.className = 'color-button'; b.setAttribute('aria-label', color.name); b.title = color.name
  b.style.setProperty('--swatch', color.base)
  if ([0, 2, 5, 6].includes(index)) b.style.setProperty('--check', '#142222')
  b.onclick = () => { state.color = index; renderSelection() }; $('#colors').append(b)
})
BLOCK_HEIGHTS.forEach((height, i) => {
  const b = document.createElement('button'); b.className = 'height-button'; b.setAttribute('aria-label', `${i + 1} times high`); b.title = `${i + 1}× high`
  const depth = (i + 1) * 3, y = 18 - depth
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 ${y} 9-4 9 4-9 4Z M3 ${y}v${depth}l9 4 9-4V${y} M12 ${y + 4}v${depth}"/>${Array.from({ length: i }, (_, j) => `<path d="m3 ${y + (j + 1) * 3} 9 4 9-4"/>`).join('')}</svg>`
  b.onclick = () => { state.height = height; renderSelection() }; $('#heights').append(b)
})
function mode(value: string) {
  state.mode = value; state.candidate = 0
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { const on = b.dataset.mode === value; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)) })
  renderSelection()
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => mode(b.dataset.mode!))
function rotate() { if (state.mode === 'place') { state.rotation = (state.rotation + 1) % 6; state.candidate = 0; renderSelection() } }
button('#rotate').onclick = rotate

function updateAim() {
  if (!renderer || !world) return
  ghost = null; resolved = null; hit = null
  let message = !state.ready ? 'Connecting to the shared world…' : state.touch ? 'Tap a spot to preview your brick' : 'Point at the floor or a brick to begin'
  if (state.ready && state.aimed) {
    const ray = renderer.camera.ray(aimX, aimY)
    hit = pick(ray.origin, ray.direction, world.records.values())
    if (state.mode === 'place' && hit) {
      const target = placementTarget(hit, state.height)
      if (target) {
        resolved = world.core.resolvePlacement(target, { sel: state.shape, rot: state.rotation, thick: state.height, rememberRotation: true })
        if (state.candidate) {
          const candidates: PlacementResult[] = []
          for (const i of ORDER[state.shape][state.rotation]) {
            const e = ELEMS[state.shape][state.rotation][i]
            if (e.d !== target.d || vclass(e.a, e.b) !== vclass(target.a, target.b)) continue
            const a0 = target.a - e.a, b0 = target.b - e.b
            if (world.core.canPlace(state.shape, a0, b0, target.ys, state.rotation, state.height)) candidates.push({ a0, b0, rk: state.rotation, ok: true, grabbed: false, contacts: world.core.contactEdges(state.shape, a0, b0, target.ys, state.rotation, state.height) })
          }
          candidates.sort((a, b) => b.contacts - a.contacts)
          if (candidates.length) resolved = candidates[state.candidate % candidates.length]
        }
        if (resolved) ghost = { valid: resolved.ok, record: { id: 0, defIdx: state.shape, a0: resolved.a0, b0: resolved.b0, ys0: target.ys, rotK: resolved.rk, thick: state.height, color: state.color, by: actor, at: 0 } }
        message = ghost?.valid ? (target.ys ? `Ready to build · ${(target.ys * .36).toFixed(2)} m above the floor` : 'Ready to build · On the floor') : 'No room here. Try another spot, shape, or rotation.'
      }
    } else if (hit?.brick && state.mode !== 'place') {
      ghost = { record: { ...hit.brick, color: state.mode === 'paint' ? state.color : hit.brick.color }, valid: state.mode === 'paint' }
      message = state.mode === 'paint' ? `Paint this brick ${PALETTE[state.color].name.toLowerCase()}` : 'Remove this brick · Undo is available'
    } else message = state.mode === 'place' ? 'Aim inside the glowing board' : 'Aim at a brick to ' + (state.mode === 'paint' ? 'paint it' : 'remove it')
  }
  renderer.setGhost(ghost)
  button('#apply').disabled = !state.ready || (state.mode === 'place' ? !ghost?.valid : !hit?.brick)
  $('#aim-status').textContent = message
}
function changed() {
  if (refreshFrame) return
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0
    renderer.setRecords(world.records.values()); updateAim()
    const total = world.records.size.toLocaleString()
    const count = `${total} ${world.records.size === 1 ? 'brick' : 'bricks'} in the world`
    $('#brick-count').textContent = count; $('#brick-total').textContent = total; $('.world-info').title = count
    button('#undo').disabled = world.history.undoDepth() === 0; button('#redo').disabled = world.history.redoDepth() === 0
    updateConnection()
  })
}
function updateConnection() {
  const pending = relay?.pendingCount() ?? 0
  const text = state.status === 'live' ? pending ? `Saving ${pending}…` : 'All changes saved' : state.status === 'offline' ? pending ? `Offline · ${pending} waiting` : 'Offline · Reconnecting' : state.status === 'syncing' ? 'Loading world…' : 'Connecting…'
  if (text !== pendingStatus) {
    pendingStatus = text; $('#connection-text').textContent = text; $('#connection').dataset.state = state.status
    button('#connection-details').title = text
    const icon = state.status === 'offline' ? 'cloud-off' : state.status === 'live' && !pending ? 'cloud-check' : 'cloud-sync'
    setIcon($('#connection-icon'), icon)
    $('#pending-count').textContent = pending > 99 ? '99+' : String(pending); $('#pending-count').hidden = !pending
  }
}
function aim(x: number, y: number, touch: boolean) {
  aimX = x; aimY = y; state.aimed = true; state.touch = touch; state.candidate = 0
  updateAim()
}
function apply() {
  if (!state.ready || performance.now() - lastApply < 130 || button('#apply').disabled) return
  lastApply = performance.now()
  let success = false
  if (state.mode === 'place' && ghost?.valid) success = !!world.place(ghost.record)
  else if (state.mode === 'paint' && hit?.brick) success = world.paint(hit.brick.id, state.color)
  else if (state.mode === 'delete' && hit?.brick) success = world.delete(hit.brick.id)
  if (success) {
    if (state.touch) navigator.vibrate?.(8)
    button('#apply').classList.add('success'); window.setTimeout(() => button('#apply').classList.remove('success'), 180)
    changed()
  }
}
button('#apply').onclick = apply
function replay(redo: boolean) { const error = world.replay(redo); if (error) toast(error); else toast(redo ? 'Redone' : 'Undone', redo ? 'redo' : 'undo'); changed() }
button('#undo').onclick = () => replay(false)
button('#redo').onclick = () => replay(true)
function cameraChanged() { renderer.invalidate(); updateAim() }
button('#zoom-in').onclick = () => { renderer.camera.zoom(.8); cameraChanged() }
button('#zoom-out').onclick = () => { renderer.camera.zoom(1.25); cameraChanged() }
button('#orbit').onclick = () => { state.orbit = !state.orbit; button('#orbit').setAttribute('aria-pressed', String(state.orbit)); toast(state.orbit ? 'Drag to orbit. Pinch still zooms.' : 'Drag to move around the board.', state.orbit ? 'orbit' : 'pan') }
button('#top-view').onclick = () => {
  const top = renderer.camera.elevation < 1.5
  renderer.camera.elevation = top ? Math.PI / 2 : .92; button('#top-view').setAttribute('aria-pressed', String(top)); cameraChanged()
}
function centerView(first = false) {
  const points = [...world.records.values()].map(r => vertexPos(r.a0, r.b0))
  const xs = points.map(p => p.x), zs = points.map(p => p.z)
  if (points.length) {
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
    renderer.camera.target = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2]
    renderer.camera.span = first ? (state.touch ? 25 : 34) : Math.min(125, Math.max(18, (maxZ - minZ + 6) * 1.7, (maxX - minX + 6) / (renderer.camera.width / renderer.camera.height) * 1.4))
  } else { renderer.camera.target = [0, 0, 0]; renderer.camera.span = state.touch ? 22 : 28 }
  state.aimed = false; cameraChanged()
}
button('#home').onclick = () => centerView()

window.addEventListener('keydown', event => {
  if (!state.ready || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (event.key === 'Escape') { if (!$('#help-panel').hidden) setHelp(false); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); replay(event.shiftKey); return }
  if (event.ctrlKey || event.metaKey) return
  if (event.target instanceof HTMLElement && event.target.closest('button, a, summary, select, [contenteditable="true"]') && [' ', 'Enter'].includes(event.key)) return
  const key = event.key.toLowerCase()
  if (['r', '2'].includes(key)) { event.preventDefault(); rotate() }
  else if (['e', ' ', 'enter'].includes(key)) { event.preventDefault(); apply() }
  else if (key === 'b') mode('place')
  else if (key === 'p') mode('paint')
  else if (key === 'x') mode('delete')
  else if (key === 'f') mode(['place', 'paint', 'delete'][(['place', 'paint', 'delete'].indexOf(state.mode) + 1) % 3])
  else if (key === '3') { state.shape = (state.shape + 1) % SHAPES.length; renderSelection() }
  else if (key === '1') { state.candidate++; updateAim() }
  else if (key === '4') replay(false)
  else if (key.startsWith('arrow')) {
    event.preventDefault()
    if (!state.aimed) { aimX = renderer.camera.width * .5; aimY = renderer.camera.height * .43 }
    const step = renderer.camera.height / renderer.camera.span * .65
    aimX += key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
    aimY += key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
    aim(Math.max(0, Math.min(renderer.camera.width, aimX)), Math.max(0, Math.min(renderer.camera.height, aimY)), state.touch)
  } else if (['w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault(); renderer.camera.pan(key === 'a' ? 30 : key === 'd' ? -30 : 0, key === 'w' ? 30 : key === 's' ? -30 : 0); cameraChanged()
  } else if (key === '+' || key === '=') { renderer.camera.zoom(.85); cameraChanged() }
  else if (key === '-') { renderer.camera.zoom(1.18); cameraChanged() }
  else if (key === '?') setHelp($('#help-panel').hidden)
})

async function start() {
  renderer = new Renderer(canvas, fail)
  await renderer.init()
  world = new World(changed, { lay: r => relay.lay(r), paint: (id, c) => relay.paint(id, c), breakBrick: id => relay.breakBrick(id) }, actor)
  const url = new URL(location.href).searchParams.get('server') ?? 'wss://interconnected.online/hexabricks/ws'
  const server = new URL(url)
  if (!['ws:', 'wss:'].includes(server.protocol)) throw new Error('The server address must start with ws:// or wss://.')
  if (location.protocol === 'https:' && server.protocol !== 'wss:') throw new Error('Use a secure wss:// server address on this HTTPS page.')
  relay = createGenesisRelay({
    address: () => actor,
    seed: () => [], // A browser never offers cached/example geometry to the live service.
    snapshot: records => {
      world.snapshot(records)
      const first = !state.ready; state.ready = true
      if (first) centerView(true)
      changed()
    },
    upsert: record => world.upsert(record), remove: id => world.remove(id), repaint: (id, color) => world.repaint(id, color),
    reject: id => { world.remove(id); toast('Another brick reached that spot first. Try a nearby space.'); changed() },
    upsertBuilder: () => {}
  }, {
    url, onStatus: status => { state.status = status; updateConnection() },
    createSocket: address => {
      const socket = new WebSocket(address)
      const timeout = window.setTimeout(() => socket.close(), 20_000)
      socket.addEventListener('message', () => clearTimeout(timeout), { once: true })
      socket.addEventListener('close', () => clearTimeout(timeout), { once: true })
      return socket
    }
  })
  timer = window.setInterval(() => { relay.tick(.25); updateConnection() }, 250)
  attachControls(canvas, renderer.camera, { camera: cameraChanged, aim, apply, orbit: () => state.orbit })
  new ResizeObserver(() => { renderer.resize(); updateAim() }).observe(canvas)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderer.invalidate() })
  window.addEventListener('beforeunload', event => { if (relay.pendingCount()) { event.preventDefault(); event.returnValue = '' } })
  window.addEventListener('pagehide', event => { if (!event.persisted) { clearInterval(timer); relay.dispose(); renderer.dispose() } })
  $('#loading').hidden = true
  canvas.dataset.renderer = 'webgpu'
  renderSelection(); renderer.invalidate()
}
start().catch(error => { console.error(error); fail(error instanceof Error ? error.message : 'Could not open the world. Reload to try again.') })
