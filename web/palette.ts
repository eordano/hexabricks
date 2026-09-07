import { BRICK_COLORS } from '../src/brick-palette.ts'
export const PALETTE = BRICK_COLORS.map(c => ({ ...c, name: c.name[0].toUpperCase() + c.name.slice(1) }))
export function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}
