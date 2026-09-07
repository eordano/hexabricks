const assert = require('node:assert/strict')
const test = require('node:test')
const { resolvePlayerTarget } = require('../src/player-names.ts')

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

test('invite target accepts a normalized wallet address', () => {
  assert.deepEqual(resolvePlayerTarget(`  ${A.toUpperCase()}  `, []), { kind: 'found', addr: A })
})

test('invite target accepts a case-insensitive display name with optional @', () => {
  const known = [{ addr: A, name: 'Eordano.dcl.eth' }]
  assert.deepEqual(resolvePlayerTarget('@eordano.dcl.eth', known), { kind: 'found', addr: A })
  assert.deepEqual(resolvePlayerTarget('EORDANO.DCL.ETH', known), { kind: 'found', addr: A })
})

test('invite target fails closed for missing and ambiguous names', () => {
  assert.deepEqual(resolvePlayerTarget('nobody', []), { kind: 'missing' })
  assert.deepEqual(resolvePlayerTarget('Alex', [
    { addr: A, name: 'Alex' },
    { addr: B, name: 'alex' }
  ]), { kind: 'ambiguous' })
})
