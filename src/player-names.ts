interface KnownPlayerName {
  addr: string
  name: string
}

const ADDRESS = /^0x[0-9a-f]{40}$/

type PlayerTargetResolution =
  | { kind: 'found'; addr: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }

function normalizedName(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('@') ? normalized.slice(1) : normalized
}

export function resolvePlayerTarget(
  target: string,
  known: Iterable<KnownPlayerName>
): PlayerTargetResolution {
  const needle = normalizedName(target)
  if (ADDRESS.test(needle)) return { kind: 'found', addr: needle }
  if (!needle) return { kind: 'missing' }

  const matches = new Set<string>()
  for (const player of known) {
    const addr = player.addr.toLowerCase()
    if (ADDRESS.test(addr) && player.name && normalizedName(player.name) === needle) matches.add(addr)
  }
  if (matches.size === 1) return { kind: 'found', addr: matches.values().next().value! }
  return matches.size > 1 ? { kind: 'ambiguous' } : { kind: 'missing' }
}
