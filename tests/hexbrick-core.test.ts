const assert = require('node:assert/strict')
const test = require('node:test')
const Core = require('../src/hexbrick-core.ts')

function restoreWedge(world, id, cell) {
  for (let rk = 0; rk < 6; rk++) {
    const e = Core.ELEMS[3][rk][0]
    if (e.d !== cell.d) continue
    const brick = world.restore({
      id,
      defIdx: 3,
      a0: cell.a - e.a,
      b0: cell.b - e.b,
      ys0: 0,
      rotK: rk,
      thick: 2
    })
    if (brick) return
  }
  assert.fail(`could not restore wedge ${id}`)
}

function legalCandidates(world, target, sel, rot, rememberRotation = false) {
  const deltas = rememberRotation ? [0] : [0, 1, 5, 2, 4, 3]
  const out = []
  const seen = new Set()
  for (const delta of deltas) {
    const rk = (rot + delta) % 6
    for (const i of Core.ORDER[sel][rk]) {
      const e = Core.ELEMS[sel][rk][i]
      if (e.d !== target.d || Core.vclass(e.a, e.b) !== Core.vclass(target.a, target.b)) continue
      const a0 = target.a - e.a
      const b0 = target.b - e.b
      const key = `${a0},${b0},${rk}`
      if (seen.has(key) || !world.canPlace(sel, a0, b0, target.ys, rk, 2)) continue
      seen.add(key)
      out.push({ a0, b0, rk, contacts: world.contactEdges(sel, a0, b0, target.ys, rk, 2) })
    }
  }
  return out
}

test('resolver maximizes shared boundary edges before rotation tie-breaks', () => {
  const target = { a: 0, b: 0, d: 0, ys: 0 }
  let sawMeaningfulChoice = false
  for (let a = -3; a <= 3 && !sawMeaningfulChoice; a++)
    for (let b = -3; b <= 3 && !sawMeaningfulChoice; b++)
      for (let d = 0; d <= 1 && !sawMeaningfulChoice; d++) {
        if (a === target.a && b === target.b && d === target.d) continue
        const world = Core.createWorld({ gridR: 8 })
        restoreWedge(world, 1, { a, b, d })
        for (let sel = 0; sel < Core.SHAPES.length; sel++) {
          const candidates = legalCandidates(world, target, sel, 0)
          if (candidates.length === 0) continue
          const scores = candidates.map((candidate) => candidate.contacts)
          if (new Set(scores).size < 2) continue
          const result = world.resolvePlacement(target, { sel, rot: 0, thick: 2 })
          assert.equal(result?.ok, true)
          assert.equal(result?.contacts, Math.max(...scores))
          sawMeaningfulChoice = true
          break
        }
      }
  assert.equal(sawMeaningfulChoice, true)
})

test('remember rotation never returns another orientation', () => {
  const world = Core.createWorld({ gridR: 8 })
  const target = { a: 0, b: 0, d: 0, ys: 0 }
  for (let sel = 0; sel < Core.SHAPES.length; sel++)
    for (let rot = 0; rot < 6; rot++) {
      const result = world.resolvePlacement(target, { sel, rot, thick: 2, rememberRotation: true })
      if (result?.ok) assert.equal(result.rk, rot)
    }
})
