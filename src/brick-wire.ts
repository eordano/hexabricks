import { BLOCK_HEIGHTS } from './scene-config.ts'

export interface BrickWireRecord {
  id: number
  defIdx: number
  a0: number
  b0: number
  ys0: number
  rotK: number
  color: number
  by: string
  at: number
  thick: number
}

const HEIGHTS = new Set<number>(BLOCK_HEIGHTS)

export function encodeBrick(record: BrickWireRecord): Array<number | string> {
  return [record.id, record.defIdx, record.a0, record.b0, record.ys0, record.rotK, record.color, record.by, record.at, record.thick]
}

export function decodeBrick(value: unknown): BrickWireRecord | null {
  if (!Array.isArray(value) || (value.length !== 9 && value.length !== 10)) return null
  const [id, defIdx, a0, b0, ys0, rotK, color, by, at, rawThick] = value
  const thick = rawThick ?? BLOCK_HEIGHTS[0]
  if (
    ![id, defIdx, a0, b0, ys0, rotK, color, at, thick].every(Number.isSafeInteger) ||
    typeof by !== 'string' ||
    typeof thick !== 'number' ||
    !HEIGHTS.has(thick)
  ) return null
  return { id, defIdx, a0, b0, ys0, rotK, color, by: by.toLowerCase(), at, thick } as BrickWireRecord
}
