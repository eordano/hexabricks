import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BrickWorld, decode } from './world.ts'

function invalid(message) {
  throw new Error(`invalid Hexabricks snapshot: ${message}`)
}

export function decodeSnapshot(saved, initialBuilders = []) {
  if (!saved || typeof saved !== 'object') invalid('root is not an object')
  if (saved.version !== undefined && saved.version !== 1 && saved.version !== 2)
    invalid(`unsupported version ${saved.version}`)
  if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) invalid('revision')
  if (!Array.isArray(saved.bricks) || !Array.isArray(saved.deleted) || !Array.isArray(saved.builders))
    invalid('bricks, deleted and builders must be arrays')

  const world = new BrickWorld()
  const deleted = new Set()
  for (const id of saved.deleted) {
    if (!Number.isSafeInteger(id) || id <= 0 || deleted.has(id)) invalid(`tombstone ${id}`)
    deleted.add(id)
  }
  for (const value of saved.bricks) {
    const record = decode(value)
    if (!record) invalid('brick tuple')
    if (deleted.has(record.id)) invalid(`brick ${record.id} is also tombstoned`)
    if (!world.add(record, true)) invalid(`brick ${record.id} collides, is duplicated or is out of bounds`)
  }

  const builders = new Map(initialBuilders.map((entry) => [entry.addr, entry]))
  for (const entry of saved.builders) {
    if (!entry || typeof entry.addr !== 'string' || !/^0x[0-9a-f]{40}$/.test(entry.addr) ||
        typeof entry.name !== 'string' || typeof entry.invitedBy !== 'string' ||
        (entry.invitedBy !== '' && !/^0x[0-9a-f]{40}$/.test(entry.invitedBy)) ||
        !Number.isSafeInteger(entry.at)) invalid('builder entry')
    builders.set(entry.addr, entry)
  }

  const clocks = new Map()
  let lamport = 0
  const rawClocks = saved.clocks ?? []
  if (!Array.isArray(rawClocks)) invalid('clocks')
  for (const value of rawClocks) {
    if (!Array.isArray(value) || value.length !== 3 || !Number.isSafeInteger(value[0]) || value[0] <= 0 ||
        !Number.isSafeInteger(value[1]) || value[1] < 0 || typeof value[2] !== 'string' || clocks.has(value[0]))
      invalid('clock entry')
    clocks.set(value[0], { l: value[1], k: value[2] })
    lamport = Math.max(lamport, value[1])
  }
  return { world, deleted, builders, clocks, revision: saved.revision, lamport }
}

export async function loadSnapshot(dataFile, initialBuilders = []) {
  let sawFile = false
  const errors = []
  for (const candidate of [dataFile, `${dataFile}.prev`]) {
    try {
      const saved = JSON.parse(await readFile(candidate, 'utf8'))
      const decoded = decodeSnapshot(saved, initialBuilders)
      return { ...decoded, source: candidate }
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      sawFile = true
      errors.push(`${candidate}: ${error.message}`)
    }
  }
  if (sawFile) throw new Error(`refusing to start with no complete snapshot\n${errors.join('\n')}`)
  return {
    world: new BrickWorld(), deleted: new Set(),
    builders: new Map(initialBuilders.map((entry) => [entry.addr, entry])),
    clocks: new Map(), revision: 0, lamport: 0, source: null
  }
}

export async function writeSnapshot(dataFile, saved, options = {}) {
  const directory = dirname(dataFile)
  const temporary = `${dataFile}.tmp`
  const previous = `${dataFile}.prev`
  const previousTemporary = `${previous}.tmp`
  await mkdir(directory, { recursive: true })

  const file = await open(temporary, 'w', 0o600)
  try {
    await file.writeFile(JSON.stringify(saved))
    await file.sync()
  } finally {
    await file.close()
  }

  if (options.rotateCurrent !== false) {
    try { await unlink(previousTemporary) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try {
      await link(dataFile, previousTemporary)
      await rename(previousTemporary, previous)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  await rename(temporary, dataFile)
  const dir = await open(directory, 'r')
  try { await dir.sync() } finally { await dir.close() }
}
