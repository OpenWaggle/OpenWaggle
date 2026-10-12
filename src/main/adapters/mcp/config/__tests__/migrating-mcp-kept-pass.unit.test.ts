import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { McpConfigurationServiceShape } from '../../../../ports/mcp-configuration-service'
import type { PendingMcpFileMigration } from '../../migration/migration-health'
import { migrateBeforeEachCall } from '../migrating-mcp-configuration-service'

const VIEWED = '/work/viewed'
const OTHER = '/work/other'

function waiting(projectPath: string): PendingMcpFileMigration {
  return {
    path: `${projectPath}/.openwaggle/mcp.json`,
    error: 'the lock is held',
    cause: 'wait',
    keepsLegacyState: true,
  }
}

/** A service whose kept projects' migrations wait for the lock another process keeps. */
function setUp(input: { readonly viewedWaits: boolean; readonly kept: readonly string[] }) {
  const inner: McpConfigurationServiceShape = fromPartial({
    getView: () => Effect.succeed(fromPartial({ servers: [], errors: [] })),
    addServer: () => Effect.void,
  })
  // Each migration of a kept project waits; this one never ends, as a lock wait of 30 s.
  const migrate = vi.fn((projectPath: string | null) =>
    projectPath === VIEWED || projectPath === null
      ? Promise.resolve()
      : new Promise<void>(() => {}),
  )
  const service = migrateBeforeEachCall(inner, migrate, {
    pendingMigration: (projectPath, scope) => {
      if (projectPath === VIEWED && input.viewedWaits) return waiting(VIEWED)
      return scope === 'all' ? undefined : input.kept.map(waiting)[0]
    },
    pendingKeptProjects: () =>
      input.kept.map((projectPath) => ({ projectPath, pending: waiting(projectPath) })),
  })
  return { service, migrate }
}

const addGlobal = { projectPath: VIEWED, scope: 'global', name: 'x', entry: {} } as const

describe('migrating kept projects again in a Settings call', () => {
  it("skips them when the viewed scope's own migration just waited for the lock", async () => {
    const { service, migrate } = setUp({ viewedWaits: true, kept: [OTHER] })

    const refused = await Effect.runPromise(Effect.flip(service.addServer(fromPartial(addGlobal))))

    expect(refused.message).toContain('try again shortly')
    expect(migrate.mock.calls).toEqual([[VIEWED]])
  })

  it('does not migrate the viewed project twice in one call', async () => {
    const { service, migrate } = setUp({ viewedWaits: false, kept: [VIEWED] })

    await Effect.runPromiseExit(service.addServer(fromPartial(addGlobal)))

    expect(migrate.mock.calls).toEqual([[VIEWED]])
  })

  it('answers a view without waiting for them', async () => {
    const { service, migrate } = setUp({ viewedWaits: false, kept: [OTHER] })

    await expect(Effect.runPromise(service.getView({ projectPath: VIEWED }))).resolves.toBeDefined()
    // Started for the next write, which then finds the project migrated or waits no more.
    expect(migrate.mock.calls).toEqual([[VIEWED], [OTHER]])
  })
})
