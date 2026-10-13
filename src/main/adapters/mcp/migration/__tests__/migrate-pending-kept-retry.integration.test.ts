import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpImportServiceShape } from '../../../../ports/mcp-import-service'
import { createFilesystemMcpConfigurationService } from '../../config/filesystem-mcp-configuration-service'
import { mcpUpdateRefusal } from '../../config/mcp-write-refusal'
import { migrateBeforeEachCall } from '../../config/migrating-mcp-configuration-service'
import { migrateBeforeImports } from '../../migrating-mcp-import-service'
import { ProcessFileLockTimeoutError } from '../../process-file-lock'
import { gateUnmigratedMcpFiles } from '../migration-gate'
import { pendingKeptProjects, pendingMcpFileMigration } from '../migration-health'
import { migrationRecordPath } from '../migration-record'
import { cleanUpPendingLegacy, setUpPendingLegacy } from './pending-legacy-setup'

afterEach(cleanUpPendingLegacy)

/**
 * A kept project whose migration waits for the lock another process keeps, and a Run's project
 * that keeps nothing. `release()` lets the next migration of the kept project run.
 */
async function keptWaitingProject() {
  const setUp = await setUpPendingLegacy()
  const { homeDir, piAgentDir } = setUp
  const kept = await setUp.danglingProject('kept')
  const other = path.join(setUp.root, 'other')
  await mkdir(other, { recursive: true })
  await setUp.migrate([kept])
  await setUp.migrate([other])
  // Its file can be read now; it is left to the next migration.
  await mkdir(path.join(setUp.root, 'unmounted', 'kept'), { recursive: true })
  let held = true
  const lockTimeout = () =>
    gateUnmigratedMcpFiles({
      homeDir,
      projectPaths: [kept],
      error: new ProcessFileLockTimeoutError(migrationRecordPath(homeDir), new Error('held')),
    })
  await lockTimeout()
  const migrateOne = vi.fn(async (projectPath: string | null) => {
    if (held && projectPath === kept) return lockTimeout()
    return setUp.migrate(projectPath ? [projectPath] : [])
  })
  const options = {
    pendingMigration: (projectPath: string | null, scope: 'all' | 'global' | 'everywhere') =>
      pendingMcpFileMigration(homeDir, projectPath, scope),
    pendingKeptProjects: () => pendingKeptProjects(homeDir),
  }
  const service = migrateBeforeEachCall(
    createFilesystemMcpConfigurationService({ homeDir, piAgentDir }),
    migrateOne,
    options,
  )
  const release = () => {
    held = false
  }
  return { ...setUp, kept, other, release, migrateOne, options, service }
}

describe("a global change waiting on another kept project's migration lock", () => {
  it("lets Pi's /mcp change through from another project's Run, with no Settings write", async () => {
    const { homeDir, piAgentDir, other, release, migrateOne, options } = await keptWaitingProject()
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    const refusal = mcpUpdateRefusal(
      { homeDir, piAgentDir, projectPath: other },
      { migrate: migrateOne, pendingKeptProjects: options.pendingKeptProjects },
    )
    expect(refusal(globalFile)?.message).toContain('try again shortly')

    release()

    // Each refusal migrates the kept project again in the background; /mcp is retried.
    await vi.waitFor(() => expect(refusal(globalFile)).toBeUndefined())
  })

  it('is no longer refused once Settings > MCP is opened again, from any scope', async () => {
    const { homeDir, release, service } = await keptWaitingProject()
    release()

    await Effect.runPromise(service.getView({ projectPath: null }))

    await vi.waitFor(() => expect(pendingMcpFileMigration(homeDir, null, 'global')).toBeUndefined())
  })

  it('refuses a global import, then lets it through once the lock is free', async () => {
    const { release, migrateOne, options } = await keptWaitingProject()
    const inner: McpImportServiceShape = fromPartial({
      apply: () => Effect.succeed(fromPartial({ imported: [] })),
    })
    const imports = migrateBeforeImports(inner, migrateOne, options)
    const apply = imports.apply(
      { projectPath: null, fingerprints: ['fp'], target: 'global', conflictPolicy: 'skip' },
      () => Effect.void,
    )

    const refused = await Effect.runPromise(Effect.flip(apply))
    expect(refused.message).toContain('try again shortly')

    release()

    await expect(Effect.runPromise(apply)).resolves.toBeDefined()
  })

  it('refuses a global write, then lets it through once the lock is free', async () => {
    const { release, service } = await keptWaitingProject()
    const turnOn = service.setServerEnabled({
      projectPath: null,
      name: 'g',
      enabled: true,
      target: 'server',
    })

    const refused = await Effect.runPromise(Effect.flip(turnOn))
    expect(refused.message).toContain('try again shortly')

    release()

    await expect(Effect.runPromise(turnOn)).resolves.toBeUndefined()
  })
})
