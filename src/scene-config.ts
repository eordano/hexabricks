export const PARCELS_X = 6
export const PARCELS_Z = 4
export const FLOOR_W = PARCELS_X * 16
export const FLOOR_D = PARCELS_Z * 16
export const ORIGIN = Object.freeze({ x: FLOOR_W / 2, z: FLOOR_D / 2 })

export const MAX_SUB = 60
export const BLOCK_HEIGHTS = Object.freeze([2, 4, 6, 8])

export const THICK_GAP = 0.045
export const BOARD_LIFT = 0.04
export const Y_LIFT = 0.0225
export const BRICK_BASE_Y = BOARD_LIFT + Y_LIFT
