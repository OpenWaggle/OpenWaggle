import { homedir } from 'node:os'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { migrateOpenWaggleMcpFiles } from '../../mcp/migration/migrate-openwaggle-mcp-files'
import { migrationRecordPath } from '../../mcp/migration/migration-record'
import { withProcessFileLock } from '../../mcp/process-file-lock'
import { getPiAgentDir } from '../pi-provider-catalog'
import { writeOpenWaggleMcpOAuthState } from './openwaggle-mcp-credentials'

const migrations = new Map<string, Promise<unknown>>()
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
 * records what it did, so later processes skip it; a failure leaves the files as they were.
 */
export function migrateOpenWaggleMcpFilesOnce(projectPath: string | null) {
  const key = projectPath ?? ''
  let migration = migrations.get(key)
  if (!migration) {
    // Two Hosts (another channel, or one starting while an old one drains) must not migrate at
    // the same time: both would read the same record and write the same files.
    const run = () =>
      withProcessFileLock(migrationRecordPath(homedir()), () => migrateOnce(projectPath), {
        waitUntilAvailable: true,
      }).catch(() => undefined)
    migration = migrationQueue.then(run)
    migrationQueue = migration
    migrations.set(key, migration)
  }
  return migration
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
