import { createWorld } from '../src/hexbrick-core.ts'
import { FLOOR_D, FLOOR_W, MAX_SUB } from '../src/scene-config.ts'
import type { BrickWireRecord as Record } from '../src/brick-wire.ts'
import { ActionHistory } from '../src/action-history.ts'

export type Edit = { before: Record | null; after: Record | null }
export interface Transport { lay(record: Record): boolean; paint(id: number, color: number): boolean; breakBrick(id: number): boolean }
export function mintId(): number {
  const values = crypto.getRandomValues(new Uint32Array(2))
  return (values[0] & 0x1fffff) * 0x100000000 + values[1] || 1
}
export class World {
  core = createWorld({ halfWidth: FLOOR_W / 2, halfDepth: FLOOR_D / 2, maxSub: MAX_SUB })
  records = new Map<number, Record>()
  history = new ActionHistory<Edit>()
  private aliases = new Map<number, number>()
  private changed: () => void
  private transport: Transport
  readonly actor: string
  constructor(changed: () => void, transport: Transport, actor: string) { this.changed = changed; this.transport = transport; this.actor = actor }
  snapshot(records: Record[]) {
    this.core = createWorld({ halfWidth: FLOOR_W / 2, halfDepth: FLOOR_D / 2, maxSub: MAX_SUB })
    this.records.clear()
    for (const record of records) if (this.valid(record) && this.core.restore(record)) this.records.set(record.id, record)
    this.changed()
  }
  private valid(r: Record) {
    return r.id > 0 && r.defIdx >= 0 && r.defIdx < 8 && r.rotK >= 0 && r.rotK < 6 && r.color >= 0 && r.color < 8 && r.ys0 % 2 === 0
  }
  upsert(record: Record) {
    if (!this.valid(record)) return
    if (this.records.has(record.id)) { this.records.set(record.id, record); this.changed(); return }
    if (this.core.restore(record)) { this.records.set(record.id, record); this.changed() }
  }
  remove(id: number) { this.core.remove(id); this.records.delete(id); this.changed() }
  repaint(id: number, color: number) { const r = this.records.get(id); if (r) { this.records.set(id, { ...r, color }); this.changed() } }
  place(input: Omit<Record, 'id' | 'by' | 'at'>): Record | null {
    if (!this.core.canPlace(input.defIdx, input.a0, input.b0, input.ys0, input.rotK, input.thick)) return null
    const record = { ...input, id: mintId(), by: this.actor, at: Date.now() }
    this.upsert(record); this.transport.lay(record); this.history.record({ before: null, after: record }); this.changed()
    return record
  }
  delete(id: number) {
    const record = this.records.get(id)
    if (!record) return false
    this.remove(id); this.transport.breakBrick(id); this.history.record({ before: record, after: null }); this.changed(); return true
  }
  paint(id: number, color: number) {
    const before = this.records.get(id)
    if (!before || before.color === color) return false
    const after = { ...before, color }
    this.repaint(id, color); this.transport.paint(id, color); this.history.record({ before, after }); this.changed(); return true
  }
  private resolveId(id: number): number {
    const seen = new Set<number>()
    while (this.aliases.has(id) && !seen.has(id)) { seen.add(id); id = this.aliases.get(id)! }
    return id
  }
  replay(redo: boolean): string | null {
    const entry = redo ? this.history.takeRedo() : this.history.takeUndo()
    if (!entry) return 'Nothing to ' + (redo ? 'redo' : 'undo')
    const expected = redo ? entry.before : entry.after, desired = redo ? entry.after : entry.before
    const id = this.resolveId((expected ?? desired)!.id), actual = this.records.get(id)
    let error: string | null = null
    if (expected && (!actual || actual.color !== expected.color)) error = 'This brick was changed by another builder.'
    else if (!expected && actual) error = 'This brick is already in the world.'
    else if (desired && !expected) {
      if (!this.core.canPlace(desired.defIdx, desired.a0, desired.b0, desired.ys0, desired.rotK, desired.thick)) error = 'That space is occupied or no longer supported.'
      else {
        const restored = { ...desired, id: mintId(), by: this.actor, at: Date.now() }
        this.aliases.set(id, restored.id); this.upsert(restored); this.transport.lay(restored)
      }
    } else if (desired) { this.repaint(id, desired.color); this.transport.paint(id, desired.color) }
    else { this.remove(id); this.transport.breakBrick(id) }
    if (error) { if (redo) this.history.cancelRedo(entry); else this.history.cancelUndo(entry) }
    else if (redo) this.history.commitRedo(entry)
    else this.history.commitUndo(entry)
    this.changed(); return error
  }
}
