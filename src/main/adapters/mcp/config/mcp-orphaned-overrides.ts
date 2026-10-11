import { isJsonRecord, MCP_OVERRIDE_KEYS } from '../../../domain/mcp/config/mcp-server-config'
import { createLogger } from '../../../logger'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  readMcpConfigLayers,
} from './mcp-config-files'
import { removeMcpServerEntry } from './mcp-config-writer'
import { loadMcpMergedConfig } from './mcp-runtime-config'

const logger = createLogger('mcp-orphaned-overrides')

interface OrphanContext {
  readonly roots: McpConfigFileRoots
  readonly reader: McpConfigFileReader
}

/** The entry for `name` in `filePath` as read, if it only sets keys an override can set. */
function overrideOnlyEntry(context: OrphanContext, filePath: string, name: string) {
  const layer = readMcpConfigLayers(mcpConfigFileLocations(context.roots), context.reader).find(
    (candidate) => candidate.path === filePath,
  )
  if (layer?.content.kind !== 'parsed') return undefined
  const servers = isJsonRecord(layer.content.value) ? layer.content.value.mcpServers : undefined
  const entry = isJsonRecord(servers) ? servers[name] : undefined
  if (!isJsonRecord(entry)) return undefined
  const overrideKeys: readonly string[] = MCP_OVERRIDE_KEYS
  return Object.keys(entry).every((key) => overrideKeys.includes(key)) ? entry : undefined
}

/**
 * Once no file defines the server, its override-only entries in OpenWaggle's files are orphans,
 * which are removed with it (in every known project for a global server; one left behind is only
 * a warning). Those in Pi's and shared files are left as they are and show up in the view's
 * errors. While any file still defines the server, could not be read, or defines it with an
 * error, they stay: the merge reports no orphan then.
 */
export function removeOrphanedOverrides(context: OrphanContext, name: string) {
  const removed: string[] = []
  try {
    const orphans = loadMcpMergedConfig(context.roots, context.reader).orphanedOverrides ?? []
    for (const orphan of orphans) {
      if (orphan.name !== name || !overrideOnlyEntry(context, orphan.path, name)) continue
      try {
        removeMcpServerEntry(orphan.path, name)
        removed.push(orphan.path)
      } catch (error) {
        // The server is already removed: a file that cannot be edited (one that repeats a key,
        // say) keeps its override, which the view shows as an orphan to remove by hand.
        logger.warn('Could not remove an orphaned MCP override', {
          path: orphan.path,
          name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.warn('Could not look for orphaned MCP overrides', {
      projectPath: context.roots.projectPath,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return removed
}

/**
 * Removes exactly the orphaned override the view reported: the override-only entry for `name` in
 * the OpenWaggle file `fileId`, while no file defines the server and every file was read. Anything
 * else is refused, so the action can never remove a server's definition, in that file or another.
 */
export function removeOrphanedOverride(
  context: OrphanContext,
  input: { readonly name: string; readonly fileId: string },
) {
  const orphan = loadMcpMergedConfig(context.roots, context.reader).orphanedOverrides?.find(
    (candidate) => candidate.name === input.name && candidate.fileId === input.fileId,
  )
  if (!orphan || !overrideOnlyEntry(context, orphan.path, input.name)) {
    throw new McpConfigurationError({
      reason: 'validation',
      message: `${input.fileId} has no orphaned override for "${input.name}" to remove: a file still defines the server, could not be read, or the entry is not an override.`,
    })
  }
  removeMcpServerEntry(orphan.path, input.name)
  return orphan.path
}
