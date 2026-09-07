const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')

const root = resolve(__dirname, '..')
const generator = join(root, 'scripts/gen-scene-crdt.ts')
const validator = join(root, 'scripts/validate-scene-snapshot.ts')

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hexabricks-validate-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const snapshot = join(directory, 'state.json')
  const crdt = join(directory, 'main.crdt')
  const entity = join(directory, 'entity.json')
  const baked = join(directory, 'baked-bricks.ts')
  writeFileSync(snapshot, JSON.stringify({
    version: 2,
    revision: 2,
    bricks: [
      [2, 3, 3, 3, 0, 0, 1, '0xaaa', 20, 2],
      [7815971452485972, 3, 0, 0, 2, 5, 7, '0xbbb', 90, 4]
    ],
    deleted: []
  }))
  execFileSync(process.execPath, [generator, snapshot, crdt, baked], { cwd: root })
  return { snapshot, crdt, entity, baked }
}

function run(paths, content) {
  writeFileSync(paths.entity, JSON.stringify({ content }))
  return spawnSync(process.execPath, [
    validator, paths.snapshot, paths.entity, paths.crdt, paths.baked
  ], { cwd: root, encoding: 'utf8' })
}

test('validates snapshot, raw CRDT, and deploy manifest as one artifact', (t) => {
  const paths = fixture(t)
  const result = run(paths, [{ file: 'main.crdt', hash: 'bafy-test' }])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    revision: 2,
    bricks: 2,
    bakedBricks: 2,
    crdtCommands: 4,
    crdtBytes: readFileSync(paths.crdt).length,
    deployFiles: 1,
    mainCrdtHash: 'bafy-test'
  })
})

test('rejects stale, experimental, and private deployment files', (t) => {
  const paths = fixture(t)
  let result = run(paths, [{ file: 'bin/main.crdt', hash: 'old' }])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /exactly one root main\.crdt/)
  result = run(paths, [
    { file: 'main.crdt', hash: 'good' },
    { file: 'state-20260906T180826Z.json', hash: 'private' }
  ])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /server backup is deployable/)
  result = run(paths, [
    { file: 'main.crdt', hash: 'good' },
    { file: 'experiments/raw-equivalent/bin/index.js', hash: 'stale' }
  ])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /legacy experiment artifact is deployable/)
  result = run(paths, [
    { file: 'main.crdt', hash: 'good' },
    { file: 'bin/scene.js', hash: 'stale' }
  ])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /legacy bin artifact is deployable/)
})
