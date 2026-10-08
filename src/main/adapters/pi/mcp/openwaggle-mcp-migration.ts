import { homedir } from 'node:os'
import { createLogger } from '../../../logger'
import { McpVaultError } from '../../../ports/mcp-errors'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { normalizeLegacyProjectPath } from '../../mcp/migration/legacy-state'
import { migrateOpenWaggleMcpFiles } from '../../mcp/migration/migrate-openwaggle-mcp-files'
import { migrationRecordPath } from '../../mcp/migration/migration-record'
import { withProcessFileLock } from '../../mcp/process-file-lock'
import { getPiAgentDir } from '../pi-provider-catalog'
import { writeOpenWaggleMcpOAuthState } from './openwaggle-mcp-credentials'

const logger = createLogger('mcp-migration')

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** How long a migration waits for another process's migration lock before it gives up. */
export const MCP_MIGRATION_LOCK_WAIT_MS = 30_000

/** After a failed migration, the next call tries again once this much time has passed. */
export const MCP_MIGRATION_RETRY_MS = 5_000

interface MigrationAttempt {
  readonly done: Promise<unknown>
  /** When the attempt failed; undefined while it runs or once it succeeded. */
  failedAt?: number
}

const migrations = new Map<string, MigrationAttempt>()
/** Runs migrations one at a time: they share the migration record and the global file. */
let migrationQueue: Promise<unknown> = Promise.resolve()

/** Session workspace roots, paged as `WorkspaceProjectAuthorization` reads them. */
async function sessionWorkspaceRoots() {
  const { listSessionWorkspaceRootPage } = await import(
    '../../../store/session-details/workspace-root-authorization'
  )
  const roots: string[] = []
  let afterRoot: string | undefined
  while (true) {
    const page = await listSessionWorkspaceRootPage(afterRoot)
    roots.push(...page)
    const last = page.at(-1)
    if (last === undefined || last === afterRoot) return roots
    afterRoot = last
  }
}

async function settingsProjectPaths() {
  const { getSettings } = await import('../../../store/settings')
  const settings = getSettings()
  return [
    ...(settings.projectPath ? [settings.projectPath] : []),
    ...settings.recentProjects,
    ...Object.keys(settings.projectDisplayNames),
  ]
}

/**
 * The projects OpenWaggle knows, so the first run keeps their servers' old on/off state: the
 * same sources as workspace authorization, settings plus every Session's workspace root.
 */
export async function knownMcpProjectPaths(): Promise<readonly string[]> {
  return [...new Set([...(await settingsProjectPaths()), ...(await sessionWorkspaceRoots())])]
}

/**
 * The project roots whose files the migration writes: settings plus every Session's project
 * path. A managed worktree is not one; writing its `.openwaggle/mcp.json` would leave an
 * untracked file in the user's checkout.
 */
async function durableMcpProjectPaths(): Promise<readonly string[]> {
  const { listSessionProjectRoots } = await import(
    '../../../store/session-details/workspace-root-authorization'
  )
  return [...new Set([...(await settingsProjectPaths()), ...(await listSessionProjectRoots())])]
}

/**
 * Runs the one-time silent migration of OpenWaggle's pre-ADR-0050 MCP files (global and this
 * project) before the project's configuration is first loaded in this process. The migration
 * records what it did, so later processes skip it; a failure leaves the files as they were, and
 * the next call after `MCP_MIGRATION_RETRY_MS` tries again.
 */
export function migrateOpenWaggleMcpFilesOnce(requestedProjectPath: string | null) {
  // One canonical spelling, the one the migration records use, so `/a/` and `/a` are one project.
  const projectPath = requestedProjectPath?.trim()
    ? normalizeLegacyProjectPath(requestedProjectPath)
    : null
  const key = projectPath ?? ''
  const previous = migrations.get(key)
  const retry =
    previous?.failedAt !== undefined && Date.now() - previous.failedAt >= MCP_MIGRATION_RETRY_MS
  if (previous && !retry) return previous.done
  const attempt: MigrationAttempt = {
    done: migrationQueue.then(() => runMigration(projectPath, attempt)),
  }
  migrationQueue = attempt.done
  migrations.set(key, attempt)
  return attempt.done
}

async function runMigration(projectPath: string | null, attempt: MigrationAttempt) {
  // Two Hosts (another channel, or one starting while an old one drains) must not migrate at
  // the same time: both would read the same record and write the same files.
  const report = await withProcessFileLock(
    migrationRecordPath(homedir()),
    () => migrateOnce(projectPath),
    // Host start must not hang on another process that keeps the lock; it tries again later.
    { waitUntilAvailable: true, maxWaitMs: MCP_MIGRATION_LOCK_WAIT_MS },
  ).catch((error: unknown) => {
    // Not cached: the attempt is marked failed below and a later call runs it again.
    logger.error('MCP migration failed; it is tried again later', {
      projectPath,
      error: describeError(error),
    })
    return undefined
  })
  // What a failed start or file left unmigrated is tried again on a later call.
  if (
    !report ||
    report.error ||
    report.files.some((file) => file.status === 'failed') ||
    report.oauth.some((signIn) => signIn.status === 'failed')
  ) {
    attempt.failedAt = Date.now()
  }
  return report
}

function migrateOnce(projectPath: string | null) {
  return migrateOpenWaggleMcpFiles({
    homeDir: homedir(),
    piAgentDir: getPiAgentDir(),
    projectPaths: projectPath ? [projectPath] : [],
    knownProjectPaths: knownMcpProjectPaths,
    now: () => new Date(),
    oauth: {
      readOld: readOldSignIn,
      write: (stateKey, state) => writeOpenWaggleMcpOAuthState(stateKey, state),
    },
    sessionMcpSwitch: async (sessionId) => carryOverSessionMcpOff(sessionId),
  })
}

/**
 * An old sign-in from the vault, or undefined when there is none. Any other vault failure (a
 * keychain that refused, an unreadable vault) is the migration's failure, so it is tried again.
 */
async function readOldSignIn(name: string) {
  try {
    return await resolveMcpVaultSecret(name)
  } catch (error) {
    if (error instanceof McpVaultError && error.reason === 'secret-not-found') return undefined
    logger.warn('Could not read an old MCP sign-in from the vault', {
      name,
      error: describeError(error),
    })
    throw error
  }
}

/** An old MCP-off switch; a Session deleted since then has nothing to carry over. */
async function carryOverSessionMcpOff(sessionId: string) {
  const { disableSessionMcp, UnknownMcpSessionError } = await import(
    '../../../store/session-mcp-switch'
  )
  await disableSessionMcp(sessionId).catch((error: unknown) => {
    if (!(error instanceof UnknownMcpSessionError)) throw error
  })
}

/**
 * At Host start, before anything reads MCP configuration: the global files and every project
 * OpenWaggle knows. Projects opened later are migrated on their first read.
 */
export async function migrateOpenWaggleMcpFilesAtHostStart() {
  await migrateOpenWaggleMcpFilesOnce(null)
  const projects = await durableMcpProjectPaths().catch((error: unknown): readonly string[] => {
    logger.error('MCP migration could not list the known projects at Host start', {
      error: describeError(error),
    })
    return []
  })
  for (const projectPath of new Set(projects)) await migrateOpenWaggleMcpFilesOnce(projectPath)
}
