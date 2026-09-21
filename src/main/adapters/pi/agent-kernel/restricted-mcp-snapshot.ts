import { createHash } from 'node:crypto'
import type { McpTurnSnapshot } from '@shared/types/mcp'

const RESTRICTION_DIGEST_CHARACTERS = 16

export function restrictMcpSnapshot(
  snapshot: McpTurnSnapshot | null,
  serverAllowlist: readonly string[] | undefined,
) {
  if (!snapshot || serverAllowlist === undefined) return snapshot
  const allowed = new Set(serverAllowlist)
  const servers = snapshot.servers.filter(
    (server) => allowed.has(server.name) || allowed.has(server.instanceId),
  )
  if (servers.length === 0) return null
  const restrictionDigest = createHash('sha256')
    .update([...allowed].sort().join('\0'))
    .digest('hex')
    .slice(0, RESTRICTION_DIGEST_CHARACTERS)
  return {
    ...snapshot,
    id: `${snapshot.id}:agent:${restrictionDigest}`,
    revision: `${snapshot.revision}:agent:${restrictionDigest}`,
    servers,
  }
}
