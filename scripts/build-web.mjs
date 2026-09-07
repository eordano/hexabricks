import { build, context } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'dist/web')
await mkdir(out, { recursive: true })
await cp(resolve(root, 'web/index.html'), resolve(out, 'index.html'))
await cp(resolve(root, 'web/favicon.svg'), resolve(out, 'favicon.svg'))
const options = {
  absWorkingDir: root, entryPoints: ['web/main.ts'], bundle: true, format: 'esm', target: ['es2022'],
  outfile: resolve(out, 'app.js'), minify: !process.argv.includes('--serve'), sourcemap: true, logLevel: 'info'
}
if (process.argv.includes('--serve')) {
  const ctx = await context(options)
  await ctx.watch()
  const server = await ctx.serve({ servedir: out, host: process.env.WEB_HOST ?? '127.0.0.1', port: Number(process.env.WEB_PORT ?? 5173) })
  console.log(`Hexabricks WebGPU: http://localhost:${server.port}`)
  console.log('Touchscreen testing on another device needs HTTPS (WebGPU secure context).')
  const { watch } = await import('node:fs')
  const watcher = watch(resolve(root, 'web'), async (_, name) => {
    if (name === 'index.html' || name === 'favicon.svg') await cp(resolve(root, 'web', name), resolve(out, name))
  })
  process.on('SIGINT', () => { watcher.close(); void ctx.dispose().then(() => process.exit(0)) })
} else {
  await build(options)
}
