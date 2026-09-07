#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const snapshotPath = process.argv[2]
const entityPath = process.argv[3]
const crdtPath = process.argv[4] || 'main.crdt'
const bakedPath = process.argv[5] || 'src/baked-bricks.ts'
if (!snapshotPath || !entityPath) {
  console.error('usage: node scripts/validate-scene-snapshot.ts SNAPSHOT ENTITY_JSON [CRDT] [BAKED_MODULE]')
  process.exit(2)
}

function fail(message) {
  throw new Error(`invalid generated scene snapshot: ${message}`)
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label)
  return value
}
function close(actual, expected, label) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-5)
    fail(`${label}: expected ${expected}, received ${actual}`)
}

async function main() {
  const Core = require('../src/hexbrick-core.ts')
  const Config = await import('../src/scene-config.ts')
  const { decode } = await import('../service/world.ts')
  const { BUILTIN_SPECS, IDS, PUT_COMPONENT, parseCrdt } = await import('../src/raw/protocol.ts')
  const codecs = new Map(BUILTIN_SPECS.map((spec) => [spec[1], spec[2]]))
  const snapshot = object(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')), 'snapshot root')
  if (!Array.isArray(snapshot.bricks)) fail('snapshot.bricks')
  const records = snapshot.bricks.map((tuple, index) => {
    const record = decode(tuple)
    if (!record) fail(`brick tuple ${index}`)
    return record
  })
  const expected = new Map(records.map((record) => [record.id, record]))
  if (expected.size !== records.length) fail('duplicate snapshot brick IDs')

  const baked = await import(pathToFileURL(path.resolve(bakedPath)).href)
  if (!Number.isSafeInteger(baked.BAKED_FIRST_ENTITY) || !Array.isArray(baked.BAKED_BY) ||
      !Array.isArray(baked.BAKED_BRICKS)) fail('baked brick module shape')
  if (baked.BAKED_BRICKS.length !== records.length) fail('baked brick count')

  const bytes = new Uint8Array(fs.readFileSync(crdtPath))
  const components = new Map()
  const allowed = new Set([IDS.Transform, IDS.GltfContainer])
  const messages = parseCrdt(bytes)
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.type !== PUT_COMPONENT || !allowed.has(message.component))
      fail(`CRDT command ${index}`)
    let entity = components.get(message.entity)
    if (!entity) components.set(message.entity, entity = new Map())
    if (entity.has(message.component))
      fail(`duplicate CRDT component ${message.component} on ${message.entity}`)
    entity.set(message.component, codecs.get(message.component).decode(message.data))
  }
  if (components.size !== records.length) fail('CRDT entity count')
  const seen = new Set()
  for (const [entityId, values] of components) {
    if (values.size !== 2 || [...allowed].some((id) => !values.has(id)))
      fail(`CRDT components on ${entityId}`)
    const row = baked.BAKED_BRICKS[entityId - baked.BAKED_FIRST_ENTITY]
    if (!Array.isArray(row) || row.length !== 10) fail(`no baked brick row for entity ${entityId}`)
    const record = expected.get(row[0])
    if (!record || seen.has(record.id)) fail(`unexpected or duplicate brick ${row[0]}`)
    seen.add(record.id)
    const data = {
      defIdx: row[1], a0: row[2], b0: row[3], ys0: row[4], rotK: row[5], color: row[6], thick: row[7],
      by: baked.BAKED_BY[row[8]], at: row[9]
    }
    for (const key of ['defIdx', 'a0', 'b0', 'ys0', 'rotK', 'color', 'thick', 'by', 'at'])
      if (data[key] !== record[key]) fail(`brick ${record.id} field ${key}`)

    const gltf = values.get(IDS.GltfContainer)
    if (gltf.src !== `models/brick-${record.defIdx}-${record.color}.glb` ||
        gltf.visibleMeshesCollisionMask !== 3 || gltf.invisibleMeshesCollisionMask !== 0)
      fail(`brick ${record.id} model or collision mask`)

    const transform = values.get(IDS.Transform)
    const point = Core.vertexPos(record.a0, record.b0)
    const x = Config.ORIGIN.x + point.x
    const z = Config.ORIGIN.z + point.z
    const yaw = -record.rotK * Math.PI / 6
    close(transform.position?.x, x, `brick ${record.id} position.x`)
    close(transform.position?.y, Config.BRICK_BASE_Y + record.ys0 * Core.HSUB, `brick ${record.id} position.y`)
    close(transform.position?.z, z, `brick ${record.id} position.z`)
    close(transform.rotation?.x, 0, `brick ${record.id} rotation.x`)
    close(transform.rotation?.y, Math.sin(yaw), `brick ${record.id} rotation.y`)
    close(transform.rotation?.z, 0, `brick ${record.id} rotation.z`)
    close(transform.rotation?.w, Math.cos(yaw), `brick ${record.id} rotation.w`)
    close(transform.scale?.x, 1, `brick ${record.id} scale.x`)
    close(transform.scale?.y, record.thick * Core.HSUB - Config.THICK_GAP, `brick ${record.id} scale.y`)
    close(transform.scale?.z, 1, `brick ${record.id} scale.z`)
  }
  if (seen.size !== expected.size) fail('CRDT brick IDs differ from snapshot')

  const entity = object(JSON.parse(fs.readFileSync(entityPath, 'utf8')), 'deployment entity')
  if (!Array.isArray(entity.content)) fail('deployment entity content')
  const files = entity.content.map((entry) => entry.file)
  if (files.filter((file) => file === 'main.crdt').length !== 1)
    fail('deployment must contain exactly one root main.crdt')
  if (files.some((file) => file.startsWith('bin/') && file !== 'bin/index.js'))
    fail('legacy bin artifact is deployable')
  if (files.some((file) => file.startsWith('experiments/') || file.startsWith('assets/')))
    fail('legacy experiment artifact is deployable')
  if (files.some((file) => /(^|\/)state-[^/]*\.json$/i.test(file) || /(^|\/)hexabricks\.json$/i.test(file)))
    fail('durable server backup is deployable')
  if (files.some((file) => /\.composite(?:\.bin)?$/i.test(file)))
    fail('source composite is deployable')

  console.log(JSON.stringify({
    revision: snapshot.revision,
    bricks: records.length,
    bakedBricks: baked.BAKED_BRICKS.length,
    crdtCommands: messages.length,
    crdtBytes: bytes.byteLength,
    deployFiles: files.length,
    mainCrdtHash: entity.content.find((entry) => entry.file === 'main.crdt').hash
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack ?? error)
  process.exitCode = 1
})
