/**
 * A write to MCP files while the one-time migration of its scope is failing would be undone when
 * the migration later succeeds and applies the old on/off state over it, so it is refused. Not
 * on a fresh install: with no old state there is nothing to apply, so nothing to undo.
 */
import type { McpConfiguredServerView } from '@shared/types/mcp-configuration'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import type { McpPendingScope, PendingMcpFileMigration } from '../migration/migration-health'

/** Which pending migrations a write waits for (`McpPendingScope`). */
export type McpWriteScope = McpPendingScope

export type PendingMcpMigrationLookup = (
  projectPath: string | null,
  scope: McpWriteScope,
) => PendingMcpFileMigration | undefined

/** Why a write must wait, worded by cause: one passes by itself, the other needs a fix. */
export function mcpWriteRefusal(pending: PendingMcpFileMigration | undefined) {
  if (!pending?.keepsLegacyState) return undefined
  const message =
    pending.cause === 'wait'
      ? `MCP settings are still being updated, so nothing was changed; try again shortly. (${pending.path}: ${pending.error})`
      : `Nothing was changed: OpenWaggle could not finish updating its MCP settings. ${mcpFixInstruction(pending)}`
  return new McpConfigurationError({ reason: 'io', message })
}

/** "Fix <file> (<error>)", naming the file once even when the error already does. */
export function mcpFixInstruction(
  pending: Pick<PendingMcpFileMigration, 'path' | 'source' | 'error'>,
) {
  const file = pending.source ?? pending.path
  return pending.error.includes(file)
    ? `Fix it: ${pending.error}.`
    : `Fix ${file} (${pending.error}).`
}

function isGlobalFileId(fileId: string) {
  return fileId === 'openwaggle-global' || fileId === 'pi-global'
}

/** Which files changing this server writes: its override's, else its defining file's. */
export function serverWriteScope(server: McpConfiguredServerView | undefined): McpWriteScope {
  if (!server) return 'all'
  const fileId = server.override?.fileId ?? server.source.fileId
  return isGlobalFileId(fileId) ? 'global' : 'all'
}

export function fileWriteScope(fileId: string): McpWriteScope {
  return isGlobalFileId(fileId) ? 'global' : 'all'
}
