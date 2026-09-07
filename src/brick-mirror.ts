import type { BrickRecord } from './persistence'

interface BrickMirrorHooks<EntityRef> {
  lay(record: BrickRecord, baked?: EntityRef): void
  breakBrick(id: number): void
  paint(id: number, color: number): void
}

export class DirtyBrickMirror<EntityRef> {
  private readonly hooks: BrickMirrorHooks<EntityRef>
  private readonly baked = new Map<number, { record: BrickRecord; entity: EntityRef }>()
  private readonly relay = new Map<number, BrickRecord>()
  private readonly deleted = new Set<number>()
  private readonly applied = new Map<number, number>()
  private readonly dirty = new Set<number>()

  constructor(hooks: BrickMirrorHooks<EntityRef>) {
    this.hooks = hooks
  }

  bake(entity: EntityRef, record: BrickRecord): void {
    this.baked.set(record.id, { entity, record })
    this.dirty.add(record.id)
  }

  deleteBaked(id: number): void {
    this.baked.delete(id)
    this.dirty.add(id)
  }

  seed(): BrickRecord[] {
    return [...this.baked.values()]
      .map((entry) => entry.record)
      .filter((record) => !this.deleted.has(record.id))
  }

  snapshot(records: BrickRecord[], deleted: number[]): void {
    const changed = new Set<number>([...this.relay.keys(), ...this.deleted])
    this.relay.clear()
    this.deleted.clear()
    for (const id of deleted) {
      this.deleted.add(id)
      changed.add(id)
    }
    for (const record of records) {
      changed.add(record.id)
      if (!this.deleted.has(record.id)) this.relay.set(record.id, record)
    }
    for (const id of changed) this.dirty.add(id)
  }

  upsert(record: BrickRecord): void {
    this.deleted.delete(record.id)
    this.relay.set(record.id, record)
    this.dirty.add(record.id)
  }

  remove(id: number): void {
    this.relay.delete(id)
    this.deleted.add(id)
    this.dirty.add(id)
  }

  repaint(id: number, color: number): void {
    const record = this.relay.get(id)
    if (record) this.relay.set(id, { ...record, color })
    this.dirty.add(id)
  }

  flush(): number {
    let processed = 0
    for (const id of this.dirty) {
      processed++
      const baked = this.deleted.has(id) ? undefined : this.baked.get(id)
      const record = this.deleted.has(id) ? undefined : this.relay.get(id) ?? baked?.record
      if (!record) {
        if (this.applied.delete(id)) {
          this.hooks.breakBrick(id)
        }
        continue
      }
      if (!this.applied.has(id)) {
        this.applied.set(id, record.color)
        this.hooks.lay(record, baked?.entity)
      } else if (this.applied.get(id) !== record.color) {
        this.applied.set(id, record.color)
        this.hooks.paint(id, record.color)
      }
    }
    this.dirty.clear()
    return processed
  }

  pendingCount(): number {
    return this.dirty.size
  }
}
