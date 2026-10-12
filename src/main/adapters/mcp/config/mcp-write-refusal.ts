/**
 * A write to MCP files while the one-time migration of its scope is failing would be undone when
 * the migration later succeeds and applies the old on/off state over it, so it is refused. Not
 * on a fresh install: with no old state there is nothing to apply, so nothing to undo.
 */
import type { McpConfiguredServerView } from '@shared/types/mcp-configuration'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import {
  type McpPendingScope,
  type PendingMcpFileMigration,
  pendingMcpFileMigration,
} from '../migration/migration-health'
import { type McpConfigFileRoots, mcpConfigFileLocations, realLocation } from './mcp-config-files'

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

/** What to do about a failing migration: wait for it, or fix the file it names. */
function pendingAdvice(pending: PendingMcpFileMigration) {
  return pending.cause === 'wait'
    ? `it waited (${pending.error}) and is tried again shortly.`
    : mcpFixInstruction(pending)
}

/** The notice for a scope whose servers all stay off while its old state waits. */
export function mcpScopePendingNotice(pending: PendingMcpFileMigration) {
  return `MCP servers stay off here until OpenWaggle has updated ${pending.path}: ${pendingAdvice(pending)}`
}

/** The notice for one file left out while its migration fails. */
export function mcpFilePendingNotice(pending: PendingMcpFileMigration) {
  return `${pending.path} was not loaded, so its servers stay off: ${pendingAdvice(pending)}`
}

/**
 * The refusal of Pi's `/mcp` change to `filePath` in a Run of `roots.projectPath`, by the scope
 * that file is in: a global file waits for any kept project, as a global write from Settings.
 */
export function mcpUpdateRefusal(roots: McpConfigFileRoots) {
  return (filePath: string) => {
    const target = realLocation(filePath)
    const file = mcpConfigFileLocations(roots).find(
      (location) => realLocation(location.path) === target,
    )
    const scope = file ? fileWriteScope(file.fileId) : 'all'
    return mcpWriteRefusal(pendingMcpFileMigration(roots.homeDir, roots.projectPath, scope))
  }
}

/**
 * Before a write that waits for other projects (`global`, `everywhere`), migrates again each kept
 * project whose migration fails, so a file fixed since no longer holds the write back.
 */
export async function migratePendingKeptProjects(
  scope: McpWriteScope,
  migrate: (projectPath: string | null) => Promise<unknown>,
  pendingProjects: (() => readonly string[]) | undefined,
) {
  if (scope === 'all' || !pendingProjects) return
  for (const projectPath of new Set(pendingProjects())) {
    await migrate(projectPath).catch(() => undefined)
  }
}
