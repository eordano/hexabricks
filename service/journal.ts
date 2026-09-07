import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { clockWins, decode } from './world.ts'

function invalid(message) {
  throw new Error(`invalid Hexabricks journal: ${message}`)
}

function validateEntry(value) {
  if (!value || typeof value !== 'object' || value.v !== 1 ||
      !Number.isSafeInteger(value.r) || value.r < 1 ||
      !Number.isSafeInteger(value.l) || value.l < 1 ||
      typeof value.k !== 'string' || value.k.length > 128)
    invalid('entry header')
  if (value.op === 'u') {
    if (!decode(value.b)) invalid(`brick at revision ${value.r}`)
  } else if (value.op === 'p') {
    if (!Number.isSafeInteger(value.id) || value.id <= 0 ||
        !Number.isSafeInteger(value.color) || value.color < 0 || value.color >= 8)
      invalid(`paint at revision ${value.r}`)
  } else if (value.op === 'x') {
    if (!Number.isSafeInteger(value.id) || value.id <= 0) invalid(`delete at revision ${value.r}`)
  } else invalid(`operation at revision ${value.r}`)
  return value
}

export function parseJournal(text) {
  if (typeof text !== 'string') invalid('content is not text')
  const complete = text.endsWith('\n')
  const lines = text.split('\n')
  if (!complete) lines.pop()
  const entries = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue
    let value
    try { value = JSON.parse(lines[i]) } catch { invalid(`JSON on line ${i + 1}`) }
    const entry = validateEntry(value)
    const previous = entries.at(-1)
    if (previous && entry.r !== previous.r + 1) invalid(`revision sequence on line ${i + 1}`)
    entries.push(entry)
  }
  return entries
}

export function replayJournal(entries, state) {
  const pending = entries.filter((entry) => entry.r > state.revision)
  if (pending.length && pending[0].r !== state.revision + 1)
    invalid(`revision gap after snapshot ${state.revision}`)
  for (const entry of pending) {
    if (entry.r !== state.revision + 1) invalid(`revision gap at ${entry.r}`)
    const incoming = { l: entry.l, k: entry.k }
    if (entry.op === 'u') {
      const record = decode(entry.b)
      if (state.deleted.has(record.id) || state.world.records.has(record.id) ||
          !state.world.add(record, true)) invalid(`cannot replay brick at revision ${entry.r}`)
      state.clocks.set(record.id, incoming)
    } else if (entry.op === 'p') {
      const record = state.world.records.get(entry.id)
      const current = state.clocks.get(entry.id)
      if (!record || !clockWins(incoming, current)) invalid(`cannot replay paint at revision ${entry.r}`)
      state.world.records.set(entry.id, { ...record, color: entry.color })
      state.clocks.set(entry.id, incoming)
    } else {
      const current = state.clocks.get(entry.id)
      if ((state.world.records.has(entry.id) || state.deleted.has(entry.id)) &&
          !clockWins(incoming, current)) invalid(`cannot replay delete at revision ${entry.r}`)
      state.world.remove(entry.id)
      state.deleted.add(entry.id)
      state.clocks.set(entry.id, incoming)
    }
    state.revision = entry.r
    state.lamport = Math.max(state.lamport, entry.l)
  }
  return pending.length
}

export async function loadJournal(journalFile, state) {
  let text
  try { text = await readFile(journalFile, 'utf8') }
  catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], applied: 0 }
    throw error
  }
  const entries = parseJournal(text)
  return { entries, applied: replayJournal(entries, state) }
}

export async function appendJournal(journalFile, entry) {
  validateEntry(entry)
  await mkdir(dirname(journalFile), { recursive: true })
  const file = await open(journalFile, 'a', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(entry)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
}

export async function replaceJournal(journalFile, entries) {
  for (const entry of entries) validateEntry(entry)
  const directory = dirname(journalFile)
  const temporary = `${journalFile}.tmp`
  await mkdir(directory, { recursive: true })
  const file = await open(temporary, 'w', 0o600)
  try {
    const text = entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : ''
    await file.writeFile(text)
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, journalFile)
  const dir = await open(directory, 'r')
  try { await dir.sync() } finally { await dir.close() }
}
