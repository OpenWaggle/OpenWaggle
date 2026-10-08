import { homedir } from 'node:os'
import { createLogger } from '../../../logger'
import { mcpBuildStateDirectory } from '../../mcp/credentials/mcp-build-state-paths'
import { normalizeLegacyProjectPath } from '../../mcp/migration/legacy-state'
import {
  type MigrateOpenWaggleMcpFilesInput,
  migrateOpenWaggleMcpFiles,
} from '../../mcp/migration/migrate-openwaggle-mcp-files'
import { migrationRecordPath } from '../../mcp/migration/migration-record'
import { SIGN_IN_NOT_READ_YET } from '../../mcp/migration/oauth-state-migration'
import { withProcessFileLock } from '../../mcp/process-file-lock'
import { getPiAgentDir } from '../pi-provider-catalog'
import { writeOpenWaggleMcpOAuthState } from './openwaggle-mcp-credentials'
import { oldSignIn, readOldSignIns } from './openwaggle-mcp-old-sign-ins'

const logger = createLogger('mcp-migration')

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** How long a migration waits for another process's migration lock before it gives up. */
export const MCP_MIGRATION_LOCK_WAIT_MS = 30_000

/** After a failed migration, the next call tries again once this much time has passed. */
export const MCP_MIGRATION_RETRY_MS = 5_000

/** How long Host stop waits for the sign-in migration it started after listening. */
export const MCP_MIGRATION_STOP_WAIT_MS = 5_000

interface MigrationAttempt {
  readonly done: Promise<unknown>
  /** When the attempt failed; undefined while it runs or once it succeeded. */
  failedAt?: number
}

/**
 * `files`: OpenWaggle's MCP files and old per-Session switches, which need no keychain. `sign-ins`:
 * also the old encrypted sign-ins, which read the vault through the operating system's keychain
 * (asynchronously, off the main thread); a slow or locked keychain must only hold up what uses MCP
 * sign-ins.
 */
type MigrationPart = 'files' | 'sign-ins'

const migrations = new Map<string, MigrationAttempt>()
/**
 * Runs migrations one at a time: they share the migration record and the global file. Only what
 * writes the record and files is queued; old sign-ins are read from the vault before, so a slow
 * keychain never holds up a files-only migration.
 */
let migrationQueue: Promise<unknown> = Promise.resolve()
/** Set at Host stop: no sign-in migration writes anything afterwards. */
let signInMigrationStopped = false
let signInsAfterHostStart: Promise<void> | undefined

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

function migrateOnceInProcess(part: MigrationPart, requestedProjectPath: string | null) {
  // One canonical spelling, the one the migration records use, so `/a/` and `/a` are one project.
  const projectPath = requestedProjectPath?.trim()
    ? normalizeLegacyProjectPath(requestedProjectPath)
    : null
  const key = `${part}:${projectPath ?? ''}`
  const previous = migrations.get(key)
  const retry =
    previous?.failedAt !== undefined && Date.now() - previous.failedAt >= MCP_MIGRATION_RETRY_MS
  if (previous && !retry) return previous.done
  const attempt: MigrationAttempt = {
    done:
      part === 'files'
        ? queued(() => runMigration(projectPath, attempt))
        : migrateSignIns(projectPath, () => attempt),
  }
  migrations.set(key, attempt)
  return attempt.done
}

function queued(run: () => Promise<unknown>) {
  const done = migrationQueue.then(run)
  migrationQueue = done.catch(() => undefined)
  return done
}

type ReadOldSignIn = NonNullable<MigrateOpenWaggleMcpFilesInput['oauth']>['readOld']

/**
 * The files and sign-ins in two queued passes, with the vault read between them, outside the queue
 * and the lock: the first pass migrates the files and asks for the old sign-ins it still needs
 * (none once they are recorded, so no keychain is read), the second moves them.
 */
async function migrateSignIns(projectPath: string | null, attempt: () => MigrationAttempt) {
  const wanted = new Set<string>()
  const first = await queuedSignIns(projectPath, attempt, async (name) => {
    wanted.add(name)
    return SIGN_IN_NOT_READ_YET
  })
  if (wanted.size === 0 || signInMigrationStopped) return first
  const oldSignIns = await readOldSignIns(wanted).catch((error: unknown) => {
    logger.error('Could not read old MCP sign-ins from the vault; they are tried again later', {
      projectPath,
      error: describeError(error),
    })
    return undefined
  })
  if (signInMigrationStopped) return undefined
  if (!oldSignIns) {
    attempt().failedAt = Date.now()
    return undefined
  }
  return queuedSignIns(projectPath, attempt, (name) => oldSignIn(oldSignIns, name))
}

function queuedSignIns(
  projectPath: string | null,
  attempt: () => MigrationAttempt,
  readOld: ReadOldSignIn,
) {
  // Host stop may come while the migration waits in the queue.
  return queued(async () =>
    signInMigrationStopped ? undefined : runMigration(projectPath, attempt(), readOld),
  )
}

/**
 * Runs the one-time silent migration of OpenWaggle's pre-ADR-0050 MCP files (global and this
 * project) before the project's configuration is first loaded in this process. It never reads
 * the keychain; old sign-ins are {@link migrateOpenWaggleMcpSignInsOnce}'s. The migration records
 * what it did, so later processes skip it; a failure leaves the files as they were, and the next
 * call after `MCP_MIGRATION_RETRY_MS` tries again.
 */
export function migrateOpenWaggleMcpFilesOnce(requestedProjectPath: string | null) {
  return migrateOnceInProcess('files', requestedProjectPath)
}

/**
 * The files' migration, then the old encrypted sign-ins of the global and this project's servers,
 * which reads the vault through the operating system's keychain. Whatever connects to MCP servers
 * or signs in to one waits for it, so an old sign-in is never written over a new one.
 */
export function migrateOpenWaggleMcpSignInsOnce(requestedProjectPath: string | null) {
  return migrateOnceInProcess('sign-ins', requestedProjectPath)
}

async function runMigration(
  projectPath: string | null,
  attempt: MigrationAttempt,
  readOld?: ReadOldSignIn,
) {
  // Two Hosts (another channel, or one starting while an old one drains) must not migrate at
  // the same time: both would read the same record and write the same files.
  const report = await withProcessFileLock(
    migrationRecordPath(homedir()),
    () => migrateOnce(projectPath, readOld),
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

function migrateOnce(projectPath: string | null, readOld: ReadOldSignIn | undefined) {
  return migrateOpenWaggleMcpFiles({
    homeDir: homedir(),
    piAgentDir: getPiAgentDir(),
    projectPaths: projectPath ? [projectPath] : [],
    knownProjectPaths: knownMcpProjectPaths,
    now: () => new Date(),
    ...(readOld
      ? {
          oauth: {
            buildKey: mcpBuildStateDirectory(),
            readOld,
            write: (stateKey: string, state: unknown) =>
              writeOpenWaggleMcpOAuthState(stateKey, state),
          },
        }
      : {}),
    sessionMcpSwitch: async (sessionId) => carryOverSessionMcpOff(sessionId),
  })
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

/** Migrates the global scope, then every project OpenWaggle knows. */
async function migrateKnownScopes(migrate: (projectPath: string | null) => Promise<unknown>) {
  await migrate(null)
  const projects = await durableMcpProjectPaths().catch((error: unknown): readonly string[] => {
    logger.error('MCP migration could not list the known projects at Host start', {
      error: describeError(error),
    })
    return []
  })
  for (const projectPath of new Set(projects)) await migrate(projectPath)
}

/**
 * At Host start, before anything reads MCP configuration: the global files and every project
 * OpenWaggle knows. Projects opened later are migrated on their first read. It does not read the
 * keychain, so Host start never waits for one (a scratch HOME's took up to three minutes).
 */
export function migrateOpenWaggleMcpFilesAtHostStart() {
  return migrateKnownScopes(migrateOpenWaggleMcpFilesOnce)
}

/**
 * Once the Host serves clients: the old sign-ins of the same scopes. A slow keychain only delays
 * MCP connections and sign-ins, which wait for this; a failure is logged and retried on use. Moving
 * an old sign-in into Pi's synchronous sign-in store still reads the keychain on the main thread.
 */
export function migrateOpenWaggleMcpSignInsAfterHostStart() {
  signInsAfterHostStart = migrateKnownScopes((projectPath) =>
    signInMigrationStopped ? Promise.resolve() : migrateOpenWaggleMcpSignInsOnce(projectPath),
  ).catch((error: unknown) => {
    logger.error('MCP sign-in migration failed after Host start; it is tried again on use', {
      error: describeError(error),
    })
  })
  return signInsAfterHostStart
}

/**
 * At Host stop, before the stores close: no sign-in migration writes anything any more, and the
 * one started after listening gets a bounded time to finish what it is writing. A sign-in it had
 * not moved yet is moved on a later start.
 */
export async function stopOpenWaggleMcpSignInMigration() {
  signInMigrationStopped = true
  if (!signInsAfterHostStart) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    signInsAfterHostStart,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MCP_MIGRATION_STOP_WAIT_MS)
    }),
  ])
  clearTimeout(timer)
}
