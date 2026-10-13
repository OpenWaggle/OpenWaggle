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
import { sameMigrationLocation } from '../migration/project-spellings'
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

/**
 * A notice about a failing migration of `pending.path`, naming each file once: `naming` names
 * that file, `plain` does not, for an error that already does. Then what to do: wait, or fix it.
 */
function pendingNotice(pending: PendingMcpFileMigration, naming: string, plain: string) {
  if (pending.cause === 'wait') {
    return `${naming}: it waited (${pending.error}) and is tried again shortly.`
  }
  if (pending.source && pending.source !== pending.path) {
    return `${naming}: ${mcpFixInstruction(pending)}`
  }
  return pending.error.includes(pending.path)
    ? `${plain} Fix it: ${pending.error}.`
    : `${naming}: fix it (${pending.error}).`
}

/** The notice for a scope whose servers all stay off while its old state waits. */
export function mcpScopePendingNotice(pending: PendingMcpFileMigration) {
  return pendingNotice(
    pending,
    `MCP servers stay off here until OpenWaggle has updated ${pending.path}`,
    'MCP servers stay off here until an MCP file is fixed.',
  )
}

/** The notice for one file left out while its migration fails. */
export function mcpFilePendingNotice(pending: PendingMcpFileMigration) {
  return pendingNotice(
    pending,
    `${pending.path} was not loaded, so its servers stay off`,
    'An MCP file was not loaded, so its servers stay off.',
  )
}

/**
 * The refusal of Pi's `/mcp` change to `filePath` in a Run of `roots.projectPath`, by the scope
 * that file is in: a global file waits for any kept project, as a global write from Settings.
 * Pi asks synchronously, so nothing is migrated first; a refused global change migrates the
 * failing kept projects again in the background (`retry`), and the next `/mcp` can go through.
 */
export function mcpUpdateRefusal(
  roots: McpConfigFileRoots,
  retry?: {
    readonly migrate: (projectPath: string | null) => Promise<unknown>
    readonly pendingKeptProjects: PendingKeptProjects
  },
) {
  let retrying: Promise<unknown> | undefined
  const migrateAgain = (scope: McpWriteScope) => {
    if (!retry || scope === 'all' || retrying) return
    retrying = migratePendingKeptProjects(scope, retry.migrate, retry.pendingKeptProjects)
      .catch(() => undefined)
      .finally(() => {
        retrying = undefined
      })
  }
  return (filePath: string) => {
    const target = realLocation(filePath)
    const file = mcpConfigFileLocations(roots).find(
      (location) => realLocation(location.path) === target,
    )
    const scope = file ? fileWriteScope(file.fileId) : 'all'
    const refusal = mcpWriteRefusal(
      pendingMcpFileMigration(roots.homeDir, roots.projectPath, scope),
    )
    if (refusal) migrateAgain(scope)
    return refusal
  }
}

/** Kept projects whose migration fails, each with its failure. */
export type PendingKeptProjects = () => ReadonlyArray<{
  readonly projectPath: string
  readonly pending: PendingMcpFileMigration
}>

/**
 * Before a write that waits for other projects (`global`, `everywhere`), migrates again each kept
 * project whose migration waited for the lock, so one the lock was freed for since no longer
 * holds the write back. It stops at the first that waited again (another process migrates) and
 * returns that failure, so the write is refused with "try again shortly" instead of waiting for
 * each. `viewed` is the scope the call migrated just before: not migrated twice, and when that
 * migration hit a lock timeout in this call (whether or not it recorded a failure), nothing else
 * is tried, as it would wait as long. The caller then refuses from what is recorded as waiting.
 */
export async function migratePendingKeptProjects(
  scope: McpWriteScope,
  migrate: (projectPath: string | null) => Promise<unknown>,
  pendingProjects: PendingKeptProjects | undefined,
  viewed?: { readonly projectPath: string | null; readonly waitedForLock: boolean },
) {
  if (scope === 'all' || !pendingProjects || viewed?.waitedForLock) return undefined
  const viewedProject = viewed?.projectPath
  const projects = pendingProjects()
    .map((kept) => kept.projectPath)
    .filter((projectPath) => !viewedProject || !sameMigrationLocation(projectPath, viewedProject))
  for (const projectPath of new Set(projects)) {
    await migrate(projectPath).catch(() => undefined)
    const waited = pendingProjects().find(
      (kept) => kept.projectPath === projectPath && kept.pending.cause === 'wait',
    )
    if (waited) return waited.pending
  }
  return undefined
}

/** The last migration lock timeout this process saw, compared before and after a migration. */
export type McpLockTimeouts = () => unknown

/**
 * Runs `migrate` (never failing) and says whether it hit a lock timeout: the last timeout seen
 * changed meanwhile. A scope with nothing to gate records no failure after its wait, so the
 * recorded failures cannot tell.
 */
export async function migrateNoting(
  lockTimeouts: McpLockTimeouts | undefined,
  migrate: () => Promise<unknown>,
) {
  const before = lockTimeouts?.()
  await migrate().catch(() => undefined)
  return lockTimeouts !== undefined && lockTimeouts() !== before
}
