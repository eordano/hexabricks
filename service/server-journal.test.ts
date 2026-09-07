import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, watch } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { WebSocket } from 'ws'

const serviceDirectory = dirname(fileURLToPath(import.meta.url))
const address = '0x1111111111111111111111111111111111111111'

async function freePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return port
}

function waitForLine(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = ''
    const deadline = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (pattern.test(output)) {
        clearTimeout(deadline)
        resolve()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(deadline)
      reject(new Error(`server exited ${code}: ${output}`))
    })
  })
}

async function startServer(dataFile, port, environment = {}) {
  const child = spawn(process.execPath, ['server.ts'], {
    cwd: serviceDirectory,
    env: {
      ...process.env,
      HEXABRICKS_HOST: '127.0.0.1',
      HEXABRICKS_PORT: String(port),
      HEXABRICKS_DATA_FILE: dataFile,
      HEXABRICKS_SNAPSHOT_EVERY_OPS: '100000',
      HEXABRICKS_SNAPSHOT_INTERVAL_MS: '3600000',
      ...environment
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk })
  await waitForLine(child, /peer listening/)
  return { child, errors: () => errors }
}

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/hexabricks/ws`)
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject))
  const messages = []
  const waiters = []
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    const index = waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message)
    else messages.push(message)
  })
  function next(predicate) {
    const index = messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject }
      waiters.push(waiter)
      const deadline = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error('timed out waiting for websocket message'))
      }, 5000)
      waiter.resolve = (value) => { clearTimeout(deadline); resolve(value) }
    })
  }
  socket.send(JSON.stringify({ t: 'h', v: 1, a: address, s: 'journal-test' }))
  return { socket, next }
}

async function stop(child, signal) {
  const exited = new Promise((resolve) => child.once('exit', (code, actualSignal) => resolve({ code, signal: actualSignal })))
  child.kill(signal)
  return exited
}


async function waitForJson(file) {
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), 2000)
  const events = watch(dirname(file), { signal: abort.signal })
  try {
    try { return JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
    for await (const event of events) {
      if (String(event.filename) !== file.slice(dirname(file).length + 1)) continue
      try { return JSON.parse(await readFile(file, 'utf8')) }
      catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
  } finally {
    clearTimeout(deadline)
    await events.return?.()
  }
  throw new Error(`timed out waiting for ${file}`)
}

test('periodic compaction exposes the last edit to the scene generator without shutdown', { timeout: 10_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-server-periodic-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dataFile = join(directory, 'state.json')
  const port = await freePort()
  const running = await startServer(dataFile, port, { HEXABRICKS_SNAPSHOT_INTERVAL_MS: '50' })
  t.after(() => { if (running.child.exitCode === null) running.child.kill('SIGKILL') })
  const client = await connect(port)
  await client.next((message) => message.t === 's')
  client.socket.send(JSON.stringify({
    t: 'l', b: [456, 3, 0, 0, 0, 0, 2, address, 1, 2], l: 1, o: 'periodic-lay'
  }))
  await client.next((message) => message.t === 'u' && message.b?.[0] === 456)

  const saved = await waitForJson(dataFile)
  assert.equal(saved.revision, 1)
  assert.equal(saved.bricks.some((value) => value[0] === 456), true)
  client.socket.terminate()
  await stop(running.child, 'SIGKILL')
})

test('acknowledged journal edit survives a hard crash before snapshot compaction', { timeout: 15_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hexabricks-server-journal-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dataFile = join(directory, 'state.json')
  const port = await freePort()

  const first = await startServer(dataFile, port)
  t.after(() => { if (first.child.exitCode === null) first.child.kill('SIGKILL') })
  const client = await connect(port)
  await client.next((message) => message.t === 's')
  const tuple = [123, 3, 0, 0, 0, 0, 2, address, 1, 2]
  client.socket.send(JSON.stringify({ t: 'l', b: tuple, l: 1, o: 'lay-1' }))
  const update = await client.next((message) => message.t === 'u' && message.b?.[0] === 123)
  assert.equal(update.r, 1)
  client.socket.terminate()
  await stop(first.child, 'SIGKILL')

  await assert.rejects(readFile(dataFile, 'utf8'), { code: 'ENOENT' })
  assert.match(await readFile(`${dataFile}.journal`, 'utf8'), /"r":1/)

  const second = await startServer(dataFile, port)
  t.after(() => { if (second.child.exitCode === null) second.child.kill('SIGKILL') })
  const recovered = await connect(port)
  const snapshot = await recovered.next((message) => message.t === 's')
  assert.equal(snapshot.r, 1)
  assert.equal(snapshot.b.some((value) => value[0] === 123), true)
  recovered.socket.close()
  const stopped = await stop(second.child, 'SIGTERM')
  assert.deepEqual(stopped, { code: 0, signal: null }, second.errors())
  const saved = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.equal(saved.revision, 1)
  assert.equal(saved.bricks.some((value) => value[0] === 123), true)
})
