const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const root = resolve(__dirname, '..')
const generator = join(root, 'scripts/gen-scene-crdt.ts')
const tuple = (id, a0 = 0, b0 = 0) => [id, 3, a0, b0, 0, 0, 2, '0xabc', 1, 2]

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hexabricks-crdt-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function run(snapshot, crdt, baked = `${crdt}.baked.ts`) {
  return execFileSync(process.execPath, [generator, snapshot, crdt, baked], {
    cwd: root,
    encoding: 'utf8'
  })
}

test('scene generation is canonical across snapshot record order', async (t) => {
  const directory = fixture(t)
  const first = join(directory, 'first.json')
  const second = join(directory, 'second.json')
  const a = join(directory, 'a.crdt')
  const b = join(directory, 'b.crdt')
  const records = [tuple(9, 3, 3), tuple(2)]
  writeFileSync(first, JSON.stringify({ version: 2, revision: 7, bricks: records, deleted: [] }))
  writeFileSync(second, JSON.stringify({ version: 2, revision: 7, bricks: [...records].reverse(), deleted: [] }))
  run(first, a)
  run(second, b)
  assert.deepEqual(readFileSync(a), readFileSync(b))
  assert.deepEqual(readFileSync(`${a}.baked.ts`), readFileSync(`${b}.baked.ts`))

  const protocol = await import('../src/raw/protocol.ts')
  const messages = protocol.parseCrdt(readFileSync(a))
  const counts = {}
  for (const message of messages) counts[message.component] = (counts[message.component] ?? 0) + 1
  assert.deepEqual(counts, {
    [protocol.IDS.Transform]: 2,
    [protocol.IDS.GltfContainer]: 2
  })
  const baked = await import(pathToFileURL(`${a}.baked.ts`).href)
  assert.equal(baked.BAKED_FIRST_ENTITY, Math.min(...messages.map((message) => message.entity)))
  assert.deepEqual(baked.BAKED_BY, ['0xabc'])
  assert.deepEqual(baked.BAKED_BRICKS, [[2, 3, 0, 0, 0, 0, 2, 2, 0, 1], [9, 3, 3, 3, 0, 0, 2, 2, 0, 1]])
})

test('scene generation rejects colliding records before touching output', (t) => {
  const directory = fixture(t)
  const snapshot = join(directory, 'collision.json')
  const crdt = join(directory, 'scene.crdt')
  writeFileSync(snapshot, JSON.stringify({
    version: 2, revision: 2, bricks: [tuple(1), tuple(2)], deleted: []
  }))
  const result = spawnSync(process.execPath, [generator, snapshot, crdt, `${crdt}.baked.ts`], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /collides/)
  assert.throws(() => readFileSync(crdt), { code: 'ENOENT' })
  assert.throws(() => readFileSync(`${crdt}.baked.ts`), { code: 'ENOENT' })
})

test('scene generation rejects a live brick that is also tombstoned', (t) => {
  const directory = fixture(t)
  const snapshot = join(directory, 'tombstone.json')
  writeFileSync(snapshot, JSON.stringify({ version: 2, revision: 2, bricks: [tuple(1)], deleted: [1] }))
  const result = spawnSync(process.execPath, [
    generator, snapshot, join(directory, 'scene.crdt'), join(directory, 'baked.ts')
  ], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /also tombstoned/)
})
