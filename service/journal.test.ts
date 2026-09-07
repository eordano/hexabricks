import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appendJournal, loadJournal, parseJournal, replaceJournal, replayJournal } from './journal.ts'
import { decodeSnapshot } from './snapshot.ts'

const tuple = (id, color = 0) => [id, 3, 0, 0, 0, 0, color, '0xabc', 1, 2]
const emptyState = (revision = 0) => decodeSnapshot({
  version: 2, revision, bricks: [], deleted: [], builders: [], clocks: []
})
const update = (revision, id = 1) => ({ v: 1, r: revision, op: 'u', b: tuple(id), l: revision, k: 'a' })

test('replays a contiguous add, paint and delete sequence', () => {
  const state = emptyState()
  const entries = [
    update(1),
    { v: 1, r: 2, op: 'p', id: 1, color: 4, l: 2, k: 'a' },
    { v: 1, r: 3, op: 'x', id: 1, l: 3, k: 'a' }
  ]
  assert.equal(replayJournal(entries, state), 3)
  assert.equal(state.revision, 3)
  assert.equal(state.world.records.size, 0)
  assert.equal(state.deleted.has(1), true)
  assert.deepEqual(state.clocks.get(1), { l: 3, k: 'a' })
})

test('ignores only an incomplete final write', () => {
  const complete = `${JSON.stringify(update(1))}\n`
  assert.deepEqual(parseJournal(`${complete}{"v":1`), [update(1)])
  assert.throws(() => parseJournal(`${complete}{broken}\n`), /JSON on line 2/)
})

test('fails closed on a revision gap after the loaded snapshot', () => {
  assert.throws(() => replayJournal([update(7)], emptyState(5)), /revision gap/)
})

test('retained journal reconstructs from previous snapshot but skips current entries', () => {
  const entries = [update(6), { v: 1, r: 7, op: 'p', id: 1, color: 5, l: 7, k: 'a' }]
  const previous = emptyState(5)
  assert.equal(replayJournal(entries, previous), 2)
  assert.equal(previous.world.records.get(1).color, 5)

  const current = decodeSnapshot({
    version: 2, revision: 6, bricks: [tuple(1)], deleted: [], builders: [], clocks: [[1, 6, 'a']]
  })
  assert.equal(replayJournal(entries, current), 1)
  assert.equal(current.world.records.get(1).color, 5)
})

test('append and atomic replacement round-trip durable entries', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-journal-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.journal')
  await appendJournal(path, update(1))
  await appendJournal(path, { v: 1, r: 2, op: 'p', id: 1, color: 3, l: 2, k: 'a' })
  const state = emptyState()
  const loaded = await loadJournal(path, state)
  assert.equal(loaded.applied, 2)
  assert.equal(state.world.records.get(1).color, 3)

  await replaceJournal(path, loaded.entries.slice(1))
  assert.deepEqual(parseJournal(await readFile(path, 'utf8')), loaded.entries.slice(1))
})
