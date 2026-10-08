/**
 * MCP Apps in transcripts from before ADR 0050 name their server by its old instance ID and old
 * config hash. The migration recorded what each ID stood for, so such an App keeps working while
 * its server still runs or connects to what it did then.
 */
import { homedir } from 'node:os'
import type { McpAppServerInput } from '../../../ports/mcp-app-runtime-service'
import {
  readLegacyMcpServerIdentities,
  readLegacyMcpServerNames,
} from '../../mcp/migration/legacy-server-names'
import type { McpLegacyServerIdentity } from '../../mcp/migration/migration-record'

export interface McpAppServerRequest extends McpAppServerInput {
  /** Set when the App named an old instance ID: what that server was. */
  readonly legacy?: McpLegacyServerIdentity
}

/** The request with an old instance ID replaced by the server name it stood for. */
export async function withLegacyAppServer<Input extends McpAppServerInput>(
  input: Input,
): Promise<Input & McpAppServerRequest> {
  const name = (await readLegacyMcpServerNames(homedir())).get(input.serverName)
  if (!name) return input
  const legacy = (await readLegacyMcpServerIdentities(homedir())).get(input.serverName)
  return { ...input, serverName: name, ...(legacy ? { legacy } : {}) }
}

/**
 * An old App still belongs to the server: it opened with the configuration the migration carried
 * over, and the server runs or connects to the same thing as then.
 */
export function legacyAppServerMatches(request: McpAppServerRequest, identity: string) {
  const { legacy } = request
  return (
    legacy?.configHash !== undefined &&
    legacy.configHash === request.serverIdentity &&
    legacy.identity === identity
  )
}
