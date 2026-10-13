import { homedir } from 'node:os'
import { resolveLegacyMcpServerReferences } from '../../../domain/mcp/migration/legacy-server-references'
import { readLegacyMcpServerNames } from '../../mcp/migration/legacy-server-names'

/**
 * A Session's MCP server allowlist with old instance IDs (from Agent definitions and Session
 * profiles written before ADR 0051) replaced by the server names the migration recorded for them.
 */
export async function resolveLegacyMcpServerAllowlist(
  allowlist: readonly string[] | undefined,
): Promise<readonly string[] | undefined> {
  if (!allowlist || allowlist.length === 0) return allowlist
  return resolveLegacyMcpServerReferences(allowlist, await readLegacyMcpServerNames(homedir()))
}
