import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const onPath = (...names: string[]) => (process.env.PATH ?? '').split(delimiter)
  .flatMap(dir => names.map(name => join(dir, name))).find(existsSync)
const executablePath = process.env.CHROMIUM_PATH ?? onPath('chromium', 'chromium-browser')
const mesaDriver = '/run/opengl-driver/share/vulkan/icd.d/lvp_icd.x86_64.json'
const nativeSoftware = process.platform === 'linux' && existsSync(mesaDriver)
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.ts', timeout: 45_000, workers: 1, outputDir: '../test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 960 },
    launchOptions: {
      executablePath,
      ...(nativeSoftware ? { env: { ...process.env, VK_DRIVER_FILES: mesaDriver } } : {}),
      args: nativeSoftware
        ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=native', '--disable-vulkan-surface']
        : ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    },
    screenshot: 'only-on-failure', trace: 'retain-on-failure'
  },
  webServer: { command: 'npm run web:start', url: 'http://127.0.0.1:5173', reuseExistingServer: true, cwd: '..' }
})
