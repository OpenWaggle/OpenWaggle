import { homedir } from 'node:os'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { migrateOpenWaggleMcpFiles } from '../../mcp/migration/migrate-openwaggle-mcp-files'
import { migrationRecordPath } from '../../mcp/migration/migration-record'
import { withProcessFileLock } from '../../mcp/process-file-lock'
import { getPiAgentDir } from '../pi-provider-catalog'
import { writeOpenWaggleMcpOAuthState } from './openwaggle-mcp-credentials'

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

/** The projects OpenWaggle knows, so the first run keeps their servers' old on/off state. */
async function knownProjectPaths() {
  const { getSettings } = await import('../../../store/settings')
  const settings = getSettings()
  return [
    ...(settings.projectPath ? [settings.projectPath] : []),
    ...settings.recentProjects,
    ...Object.keys(settings.projectDisplayNames),
  ]
}

/**
 * Runs the one-time silent migration of OpenWaggle's pre-ADR-0048 MCP files (global and this
 * project) before the project's configuration is first loaded in this process. The migration
 * records what it did, so later processes skip it; a failure leaves the files as they were, and
 * the next call after `MCP_MIGRATION_RETRY_MS` tries again.
 */
export function migrateOpenWaggleMcpFilesOnce(projectPath: string | null) {
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
    { waitUntilAvailable: true },
  ).catch(() => undefined)
  // What a failed start or file left unmigrated is tried again on a later call.
  if (!report || report.error || report.files.some((file) => file.status === 'failed')) {
    attempt.failedAt = Date.now()
  }
  return report
}

function migrateOnce(projectPath: string | null) {
  return migrateOpenWaggleMcpFiles({
    homeDir: homedir(),
    piAgentDir: getPiAgentDir(),
    projectPaths: projectPath ? [projectPath] : [],
    knownProjectPaths,
    now: () => new Date(),
    oauth: {
      readOld: (name) => resolveMcpVaultSecret(name).catch(() => undefined),
      write: (stateKey, state) => writeOpenWaggleMcpOAuthState(stateKey, state),
    },
    sessionMcpSwitch: async (sessionId) =>
      (await import('../../../store/session-mcp-switch')).disableSessionMcp(sessionId),
  })
}

/**
 * At Host start, before anything reads MCP configuration: the global files and every project
 * OpenWaggle knows. Projects opened later are migrated on their first read.
 */
export async function migrateOpenWaggleMcpFilesAtHostStart() {
  await migrateOpenWaggleMcpFilesOnce(null)
  const projects = await knownProjectPaths().catch(() => [])
  for (const projectPath of new Set(projects)) await migrateOpenWaggleMcpFilesOnce(projectPath)
}
