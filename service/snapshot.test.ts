import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { decodeSnapshot, loadSnapshot, writeSnapshot } from './snapshot.ts'

const brick = (id = 1) => [id, 3, 0, 0, 0, 0, 0, '0xabc', 1, 2]
const saved = (revision, bricks = [brick()]) => ({
  version: 2, revision, bricks, deleted: [], builders: [], clocks: []
})

test('rejects an entire snapshot instead of silently dropping one bad brick', () => {
  assert.throws(
    () => decodeSnapshot(saved(4, [brick(), [2, 99, 0, 0, 0, 0, 0, '0xabc', 1, 2]])),
    /brick tuple/
  )
})

test('falls back to the previous complete generation when current is corrupt', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-snapshot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.json')
  await writeFile(path, '{broken')
  await writeFile(`${path}.prev`, JSON.stringify(saved(9)))
  const loaded = await loadSnapshot(path)
  assert.equal(loaded.revision, 9)
  assert.equal(loaded.world.records.size, 1)
  assert.equal(loaded.source, `${path}.prev`)
})

test('durable replacement retains the prior complete generation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-snapshot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.json')
  await writeSnapshot(path, saved(10))
  await writeSnapshot(path, saved(11, [brick(), [2, 3, 3, 3, 0, 0, 1, '0xabc', 2, 2]]))
  assert.equal(JSON.parse(await readFile(path)).revision, 11)
  assert.equal(JSON.parse(await readFile(`${path}.prev`)).revision, 10)
})

test('unknown snapshot versions fail closed', () => {
  assert.throws(() => decodeSnapshot({ ...saved(1), version: 99 }), /unsupported version/)
})

test('repairing from fallback never rotates a corrupt current file over the good previous file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-snapshot-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.json')
  await writeFile(path, '{corrupt')
  await writeFile(`${path}.prev`, JSON.stringify(saved(8, [])))
  await writeSnapshot(path, saved(9, []), { rotateCurrent: false })
  assert.equal(JSON.parse(await readFile(path, 'utf8')).revision, 9)
  assert.equal(JSON.parse(await readFile(`${path}.prev`, 'utf8')).revision, 8)
})
