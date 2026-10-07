import { homedir } from 'node:os'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { migrateOpenWaggleMcpFiles } from '../../mcp/migration/migrate-openwaggle-mcp-files'
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
    const run = () =>
      migrateOpenWaggleMcpFiles({
        homeDir: homedir(),
        projectPaths: projectPath ? [projectPath] : [],
        knownProjectPaths,
        now: () => new Date(),
        oauth: {
          readOld: (name) => resolveMcpVaultSecret(name).catch(() => undefined),
          write: (stateKey, state) => writeOpenWaggleMcpOAuthState(stateKey, state),
        },
      }).catch(() => undefined)
    migration = migrationQueue.then(run)
    migrationQueue = migration
    migrations.set(key, migration)
  }
  return migration
}
