const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { gzipSync } = require('node:zlib')

function esbuild() {
  const candidates = [process.env.ESBUILD_BIN, resolve('node_modules/.bin/esbuild')].filter(Boolean)
  try {
    for (const entry of readdirSync('/nix/store'))
      if (entry.includes('-esbuild-')) candidates.push(`/nix/store/${entry}/bin/esbuild`)
  } catch {}
  const found = candidates.find(existsSync)
  if (!found) throw new Error('esbuild not found; set ESBUILD_BIN')
  return found
}

const output = resolve('bin/index.js')
for (const stale of ['bin/scene.js', 'bin/sdk-runtime.js', 'bin/main.crdt', '.dcl-one/split'])
  rmSync(resolve(stale), { force: true })
rmSync(resolve('.dcl-one/release'), { force: true, recursive: true })
mkdirSync(resolve('bin'), { recursive: true })
const result = spawnSync(esbuild(), [
  resolve('src/raw/index.ts'),
  '--bundle',
  '--format=cjs',
  '--platform=neutral',
  '--external:~system/*',
  `--tsconfig=${resolve('tsconfig.json')}`,
  '--minify',
  `--outfile=${output}`
], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const bundle = readFileSync(output)
console.log(JSON.stringify({
  output,
  bytes: bundle.byteLength,
  gzipBytes: gzipSync(bundle).byteLength
}, null, 2))
