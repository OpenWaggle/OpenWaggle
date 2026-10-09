import { isOpenWaggleMcpConfigFile } from '../../../domain/mcp/config/mcp-config-merge'
import { isJsonRecord, isMcpOverrideEntry } from '../../../domain/mcp/config/mcp-server-config'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  readMcpConfigLayers,
} from './mcp-config-files'
import { removeMcpServerEntry } from './mcp-config-writer'
import { loadMcpMergedConfig } from './mcp-runtime-config'

interface OrphanContext {
  readonly roots: McpConfigFileRoots
  readonly reader: McpConfigFileReader
}

/**
 * Once no file defines the server, its override-only entries are orphans. Those in OpenWaggle's
 * files are removed with it (in every known project for a global server; one left behind is only a
 * warning); those in Pi's and shared files are left as they are and show up in the view's errors.
 * While any file still defines the server, they stay.
 */
export function removeOrphanedOverrides(context: OrphanContext, name: string) {
  const merged = loadMcpMergedConfig(context.roots, context.reader)
  if (merged.servers.some((server) => server.name === name)) return []
  const removed: string[] = []
  for (const layer of readMcpConfigLayers(mcpConfigFileLocations(context.roots), context.reader)) {
    if (!isOpenWaggleMcpConfigFile(layer.fileId) || layer.content.kind !== 'parsed') continue
    const servers = isJsonRecord(layer.content.value) ? layer.content.value.mcpServers : undefined
    const entry = isJsonRecord(servers) ? servers[name] : undefined
    if (!isJsonRecord(entry) || !isMcpOverrideEntry(entry)) continue
    removeMcpServerEntry(layer.path, name)
    removed.push(layer.path)
  }
  return removed
}

/**
 * Removes exactly the orphaned override the view reported: the override-only entry for `name` in
 * the OpenWaggle file `fileId`, while no file defines the server. Anything else is refused, so
 * the action can never remove a server's definition, in that file or any other.
 */
export function removeOrphanedOverride(
  context: OrphanContext,
  input: { readonly name: string; readonly fileId: string },
) {
  const orphan = loadMcpMergedConfig(context.roots, context.reader).orphanedOverrides?.find(
    (candidate) => candidate.name === input.name && candidate.fileId === input.fileId,
  )
  if (!orphan) {
    throw new McpConfigurationError({
      reason: 'validation',
      message: `${input.fileId} has no orphaned override for "${input.name}" to remove: a file still defines the server, or the entry is gone.`,
    })
  }
  removeMcpServerEntry(orphan.path, input.name)
  return orphan.path
}
