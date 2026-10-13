import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpConfigurationServiceShape } from '../../../../ports/mcp-configuration-service'
import type { McpImportServiceShape } from '../../../../ports/mcp-import-service'
import { migrateBeforeImports } from '../../migrating-mcp-import-service'
import {
  forgetMcpFileMigrationOutcomes,
  pendingKeptProjects,
  pendingMcpFileMigration,
  recordMcpFileMigrationOutcome,
} from '../../migration/migration-health'
import { migrateBeforeEachCall } from '../migrating-mcp-configuration-service'

const HOME = '/scratch/home'
const VIEWED = '/work/viewed'
const OTHER = '/work/other'
const OTHER_FILE = `${OTHER}/.openwaggle/mcp.json`

afterEach(() => {
  forgetMcpFileMigrationOutcomes()
})

/**
 * Kept project OTHER waited for the lock earlier; each migration of it waits again, here for
 * good, as for 30 s. `viewed` says what the viewed scope's migration does in this call.
 */
function setUp(
  viewed: 'migrates' | 'waits-recording-nothing' | 'waits-keeping-nothing',
  keptWaiting: readonly string[] = [OTHER],
) {
  for (const projectPath of keptWaiting) {
    recordMcpFileMigrationOutcome(`${projectPath}/.openwaggle/mcp.json`, 'lock held', {
      cause: 'wait',
    })
  }
  let lockTimeouts = 0
  const migrate = vi.fn((projectPath: string | null) => {
    if (projectPath === OTHER) return new Promise<void>(() => {})
    if (projectPath === VIEWED && viewed !== 'migrates') {
      lockTimeouts += 1
      // Added after the first run: its gate keeps no old state. With nothing to gate, none.
      if (viewed === 'waits-keeping-nothing') {
        recordMcpFileMigrationOutcome(`${VIEWED}/.openwaggle/mcp.json`, 'lock held', {
          cause: 'wait',
          keepsLegacyState: false,
        })
      }
    }
    return Promise.resolve()
  })
  const options = {
    pendingMigration: (projectPath: string | null, scope: 'all' | 'global' | 'everywhere') =>
      pendingMcpFileMigration(HOME, projectPath, scope),
    pendingKeptProjects: () => pendingKeptProjects(HOME),
    lockTimeouts: () => lockTimeouts,
  }
  const addServer = vi.fn(() => Effect.void)
  const inner: McpConfigurationServiceShape = fromPartial({
    getView: () => Effect.succeed(fromPartial({ servers: [], errors: [] })),
    addServer,
  })
  const apply = vi.fn(() => Effect.succeed(fromPartial({ imported: [] })))
  const imports: McpImportServiceShape = fromPartial({ apply })
  return {
    migrate,
    addServer,
    apply,
    service: migrateBeforeEachCall(inner, migrate, options),
    imports: migrateBeforeImports(imports, migrate, options),
  }
}

const addGlobal = { projectPath: VIEWED, scope: 'global', name: 'x', entry: {} } as const
const importGlobal = {
  projectPath: VIEWED,
  fingerprints: ['fp'],
  target: 'global',
  conflictPolicy: 'skip',
} as const

describe('migrating kept projects again in a Settings call', () => {
  it.for(['waits-recording-nothing', 'waits-keeping-nothing'] as const)(
    'waits for the lock once when the viewed scope just waited (%s), and refuses',
    async (viewed) => {
      const { service, imports, migrate, addServer, apply } = setUp(viewed)

      const refusals = await Promise.all([
        Effect.runPromise(Effect.flip(service.addServer(fromPartial(addGlobal)))),
        Effect.runPromise(Effect.flip(imports.apply(fromPartial(importGlobal), () => Effect.void))),
      ])

      for (const refused of refusals) {
        expect(refused.message).toContain('try again shortly')
        expect(refused.message).toContain(OTHER_FILE)
      }
      // The kept project is not migrated again: that would wait for the lock a second time.
      expect(migrate.mock.calls).toEqual([[VIEWED], [VIEWED]])
      expect(addServer).not.toHaveBeenCalled()
      expect(apply).not.toHaveBeenCalled()
    },
  )

  it('does not migrate the viewed project twice in one call', async () => {
    // The viewed project is kept and waiting; its migration here leaves it so.
    const { service, migrate } = setUp('migrates', [VIEWED])

    await Effect.runPromiseExit(service.addServer(fromPartial(addGlobal)))

    expect(migrate.mock.calls).toEqual([[VIEWED]])
  })

  it('answers a view without waiting for them', async () => {
    const { service, migrate } = setUp('migrates')

    await expect(Effect.runPromise(service.getView({ projectPath: VIEWED }))).resolves.toBeDefined()
    // Started for the next write, which then finds the project migrated or waits no more.
    expect(migrate.mock.calls).toEqual([[VIEWED], [OTHER]])
  })
})
