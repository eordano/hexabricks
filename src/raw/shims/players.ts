import { getUserData } from '~system/UserIdentity'
import { getPlayerData, getPlayersInScene } from '~system/Players'

export interface Player {
  userId: string
  name: string
}

interface PlayerSource {
  userId: string
  displayName?: string
  name?: string
}

const cache = new Map<string, Player>()
const entered: Array<(player: Player) => void> = []
const left: Array<(userId: string) => void> = []
let selfId = ''
let elapsed = 0
let polling = false

function normalize(data: PlayerSource | undefined): Player | undefined {
  if (!data?.userId) return undefined
  return { userId: data.userId.toLowerCase(), name: data.name ?? data.displayName ?? '' }
}

function remember(data: PlayerSource | undefined): void {
  const player = normalize(data)
  if (!player) return
  const fresh = !cache.has(player.userId)
  cache.set(player.userId, player)
  if (fresh) for (const callback of entered) callback(player)
}

async function refresh(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const result = await getPlayersInScene({})
    const present = new Set(result.players.map((entry) => entry.userId.toLowerCase()))
    if (selfId) present.add(selfId)
    for (const userId of present) {
      if (cache.has(userId)) continue
      try {
        const response = await getPlayerData({ userId })
        remember(response.data)
      } catch {}
    }
    for (const userId of [...cache.keys()]) {
      if (userId === selfId || present.has(userId)) continue
      cache.delete(userId)
      for (const callback of left) callback(userId)
    }
  } finally {
    polling = false
  }
}

export const __players = {
  async preload(): Promise<void> {
    try {
      const response = await getUserData({})
      selfId = response.data?.userId?.toLowerCase() ?? ''
      remember(response.data)
    } catch {}
    await refresh()
  },
  async tick(dt: number): Promise<void> {
    elapsed += dt
    if (elapsed < 2) return
    elapsed = 0
    await refresh()
  }
}

const players = {
  getPlayer(options: { userId?: string } = {}): Player | undefined {
    const userId = options.userId?.toLowerCase() ?? selfId
    return cache.get(userId)
  },
  onEnterScene(callback: (player: Player) => void): void { entered.push(callback) },
  onLeaveScene(callback: (userId: string) => void): void { left.push(callback) }
}

export default players
