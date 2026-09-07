import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { installGPUReadback } from './gpu-readback.ts'

let server: ChildProcess, serviceURL: string, healthURL: string
test.beforeEach(async () => {
  const probe = createServer()
  await new Promise<void>(r => probe.listen(0, '127.0.0.1', r))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(r => probe.close(() => r()))
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-browser-test-'))
  serviceURL = `ws://127.0.0.1:${port}/hexabricks/ws`; healthURL = `http://127.0.0.1:${port}/hexabricks/health`
  server = spawn(process.execPath, ['service/server.ts'], { cwd: resolve(import.meta.dirname, '../..'), env: { ...process.env, HEXABRICKS_PORT: String(port), HEXABRICKS_DATA_FILE: join(directory, 'world.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test persistence service did not start')), 8000)
    server.stdout!.on('data', chunk => { if (chunk.toString().includes('peer listening')) { clearTimeout(timeout); resolve() } })
    server.once('error', reject)
  })
})
test.afterEach(() => server?.kill('SIGTERM'))
async function open(page: Page) {
  await page.goto(`/?server=${encodeURIComponent(serviceURL)}`)
  await expect(page.locator('#world')).toHaveAttribute('data-renderer', 'webgpu')
  await expect(page.locator('#connection-text')).toHaveText('All changes saved')
}
async function count() { return (await (await fetch(healthURL)).json()).bricks as number }

test('desktop native WebGPU: place, paint, undo, redo and delete synchronize with a second client', async ({ page, browser }) => {
  const errors: string[] = []
  await installGPUReadback(page)
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const peer = await browser.newPage(); await open(page); await open(peer)
  const before = await count()
  await page.mouse.click(720, 420)
  await expect.poll(count).toBe(before + 1)
  expect(await page.evaluate(() => (window as unknown as { captureGPUColors(): Promise<number> }).captureGPUColors())).toBeGreaterThan(20)
  await expect(peer.locator('#brick-count')).toHaveText(`${before + 1} brick${before ? 's' : ''} in the world`)
  await page.getByRole('button', { name: 'Paint', exact: true }).click()
  await expect(page.locator('#apply')).toHaveAccessibleName('Paint brick')
  await expect(page.locator('#apply-icon')).toHaveAttribute('data-icon', 'paint')
  await page.getByRole('button', { name: 'Sea', exact: true }).click()
  await page.mouse.click(720, 420)
  await expect(page.locator('#connection-text')).toHaveText('All changes saved')
  await page.getByRole('button', { name: 'Undo (Ctrl or Command Z)', exact: true }).click()
  await expect(page.locator('#toast')).toHaveText('Undone')
  await page.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)', exact: true }).click()
  await expect(page.locator('#toast')).toHaveText('Redone')
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('#apply')).toHaveAccessibleName('Remove brick')
  await expect(page.locator('#apply-icon')).toHaveAttribute('data-icon', 'erase')
  await page.mouse.click(720, 420)
  await expect.poll(count).toBe(before)
  await page.locator('#undo').click(); await expect.poll(count).toBe(before + 1)
  await expect(peer.locator('#brick-count')).toHaveText(`${before + 1} brick${before ? 's' : ''} in the world`)
  expect(errors).toEqual([])
  await peer.close()
})

test('touch: tap only previews; Place commits; drag and pinch never edit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage(); await open(page)
  const before = await count()
  await page.touchscreen.tap(145, 380)
  await expect(page.getByRole('button', { name: 'Place brick', exact: true })).toBeEnabled()
  expect(await count()).toBe(before)
  await page.locator('#apply').tap()
  await expect.poll(count).toBe(before + 1)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 350, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 390, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 330, id: 1 }, { x: 230, y: 420, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 300, id: 1 }, { x: 260, y: 450, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  expect(await count()).toBe(before + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.close()
})

test('missing WebGPU shows an actionable compatibility message', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }))
  await page.goto('/')
  await expect(page.locator('#error-message')).toContainText('WebGPU is unavailable')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('#loading')).toBeHidden()
})

test('keyboard building and responsive controls at desktop, portrait, small phone and landscape sizes', async ({ page }) => {
  await open(page)
  await page.locator('#world').focus()
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#apply')).toBeEnabled()
  await page.keyboard.press('r'); await expect(page.locator('#rotation-label')).toHaveText('60°')
  await page.keyboard.press('3'); await expect(page.locator('#selection-name')).toHaveText('Half')
  for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844], ['small-phone', 320, 640], ['landscape', 844, 390], ['small-landscape', 568, 320]] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('#apply')).toBeVisible()
    const box = await page.locator('.build-tray').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1)
    if (width <= 700 || height <= 580) {
      const sizes = await page.locator('#shapes button, #colors button, #heights button, #rotate, #apply, .tools button, .top-actions button').evaluateAll(buttons => buttons.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height] }))
      expect(sizes.every(([w, h]) => w >= 44 && h >= 44)).toBe(true)
    }
  }
})

test('Enter on a focused link keeps native navigation and never edits the world', async ({ page }) => {
  await open(page)
  const before = await count()
  await page.mouse.move(850, 400)
  await expect(page.locator('#apply')).toBeEnabled()
  await page.locator('.brand').evaluate(link => link.setAttribute('href', '#navigation-test'))
  await page.locator('.brand').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#navigation-test$/)
  expect(await count()).toBe(before)
})

test('a disconnected browser queues an edit and merges it after reconnecting', async ({ page }) => {
  let disconnect = () => {}
  const sent: string[] = []
  await page.routeWebSocket(serviceURL, client => {
    const upstream = client.connectToServer()
    client.onMessage(raw => { sent.push(JSON.parse(String(raw)).t); upstream.send(raw) })
    upstream.onMessage(raw => client.send(raw))
    disconnect = () => { upstream.close({ code: 1001, reason: 'Reconnect test' }); client.close({ code: 1001, reason: 'Reconnect test' }) }
  })
  await open(page)
  const before = await count()
  disconnect()
  await expect(page.locator('#connection-text')).toContainText('Offline')
  await page.mouse.move(900, 430)
  await expect(page.locator('#apply')).toBeEnabled()
  await page.keyboard.press('e')
  await expect(page.locator('#connection-text')).toContainText('1 waiting')
  await expect(page.locator('#connection-icon')).toHaveAttribute('data-icon', 'cloud-off')
  await expect(page.locator('#pending-count')).toHaveText('1')
  await page.getByRole('button', { name: 'Connection details', exact: true }).click()
  await expect(page.locator('#help-panel')).toBeVisible()
  await page.locator('#help-toggle').click()
  await expect.poll(count).toBe(before + 1)
  await expect(page.locator('#connection-text')).toHaveText('All changes saved')
  expect(sent.filter(t => t === 'h').length).toBeGreaterThanOrEqual(2)
  expect(sent).not.toContain('m')
})
