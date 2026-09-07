const assert = require('node:assert/strict')
const test = require('node:test')
const { ActionHistory } = require('../src/action-history.ts')

test('new work clears redo while preserving operation kind', () => {
  const history = new ActionHistory()
  history.record({ kind: 'paint', id: 7, before: 1, after: 5 })
  const paint = history.takeUndo()
  history.commitUndo(paint)
  assert.equal(history.redoDepth(), 1)
  history.record({ kind: 'delete', brick: { id: 8 } })
  assert.equal(history.redoDepth(), 0)
  assert.equal(history.takeUndo().kind, 'delete')
})

test('undo can replace a deleted brick with its newly restored id', () => {
  const history = new ActionHistory()
  history.record({ kind: 'delete', brick: { id: 10, color: 2 } })
  const deletion = history.takeUndo()
  history.commitUndo({ ...deletion, brick: { ...deletion.brick, id: 99 } })
  assert.deepEqual(history.takeRedo(), {
    kind: 'delete', brick: { id: 99, color: 2 }
  })
})

test('failed inverse returns the entry to the same stack', () => {
  const history = new ActionHistory()
  const entry = { kind: 'place', brick: { id: 4 } }
  history.record(entry)
  history.cancelUndo(history.takeUndo())
  assert.equal(history.undoDepth(), 1)
  assert.equal(history.redoDepth(), 0)
})

test('history is bounded to keep long sessions memory-stable', () => {
  const history = new ActionHistory(3)
  for (let id = 1; id <= 5; id++) history.record({ kind: 'place', id })
  assert.equal(history.undoDepth(), 3)
  assert.deepEqual([history.takeUndo().id, history.takeUndo().id, history.takeUndo().id], [5, 4, 3])
})
