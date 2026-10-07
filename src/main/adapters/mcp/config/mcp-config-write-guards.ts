import type { McpWriteDestination } from '@shared/types/mcp-configuration'
import {
  type McpMergedServer,
  mcpConfigFileScope,
} from '../../../domain/mcp/config/mcp-config-merge'
import { mcpNamespace } from '../../../domain/mcp/config/mcp-server-config'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'

function refuse(message: string): never {
  throw new McpConfigurationError({ reason: 'validation', message })
}

/** A new server's file must belong to the scope it is added for. */
export function assertDestinationInScope(
  destination: McpWriteDestination,
  scope: 'global' | 'project',
) {
  const fileScope = mcpConfigFileScope(destination)
  if (fileScope === scope) return
  refuse(
    `${destination} is a ${fileScope === 'project' ? 'project' : 'global'} file; choose a ${scope} file for a ${scope} server.`,
  )
}

/** A per-project switch is saved to a project file, never to a global one. */
export function assertProjectDestination(destination: McpWriteDestination) {
  if (mcpConfigFileScope(destination) === 'project') return
  refuse(`${destination} is a global file; a switch for one project is saved to a project file.`)
}

/** Pi refuses provider `auth` outside a global `mcp.json`, so it is never written to a project file. */
export function assertNoProjectAuth(
  destination: McpWriteDestination,
  entry: Readonly<Record<string, unknown>>,
) {
  if (mcpConfigFileScope(destination) !== 'project' || entry.auth === undefined) return
  refuse('auth is only allowed in a global mcp.json.')
}

/**
 * A new name must be free in every file of the set, also as a `-`/`_` variant (they share a tool
 * namespace). `replace` lets the same exact name be written again, never a look-alike.
 */
export function assertNameFree(
  servers: readonly McpMergedServer[],
  name: string,
  options: { readonly replace?: boolean } = {},
) {
  const existing = servers.find((server) => mcpNamespace(server.name) === mcpNamespace(name))
  if (!existing || (options.replace === true && existing.name === name)) return
  refuse(
    `An MCP server named "${existing.name}" is already configured in ${existing.source.path}. Choose another name.`,
  )
}
