import { fromPartial } from '@total-typescript/shoehorn'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const started = vi.hoisted(() => {
  const names: string[] = []
  return names
})

function recorded(name: string) {
  return Effect.sync(() => {
    started.push(name)
  })
}

vi.mock('../session-host/session-tool-gateway-installer', () => ({
  installAppSessionToolGateway: recorded('tool gateway'),
}))
vi.mock('../application/session-export-recovery', () => ({
  runSessionExportRecoveryBackground: recorded('export recovery'),
}))
vi.mock('../adapters/session-scratch-sweep-background', () => ({
  runSessionScratchSweepBackground: recorded('scratch sweep'),
}))
vi.mock('../session-host/scheduled-task-scheduler', () => ({
  runScheduledTaskSchedulerBackground: recorded('scheduled tasks'),
}))
vi.mock('../application/follow-up-edit-hold-expiry', () => ({
  runFollowUpEditHoldExpiryBackground: recorded('follow-up edit hold expiry'),
}))
vi.mock('../application/pi-session-discovery', () => ({
  runPiSessionDiscoveryBackground: () => recorded('pi session discovery'),
}))
vi.mock('../adapters/session-semantic-discovery-background', () => ({
  runSessionSemanticDiscoveryBackground: recorded('semantic discovery'),
}))
vi.mock('../store/session-details/snapshot-transcript-term-projection', () => ({
  runTranscriptTermRepairBackground: recorded('transcript term repair'),
}))
vi.mock('../application/extension-trusted-main-activation-service', () => ({
  activateTrustedMainExtensionsForActiveProjectSafely: () => recorded('trusted extensions'),
}))

vi.mock('../adapters/sqlite-wal-checkpoint-background', () => ({
  runWalCheckpointBackground: () => recorded('wal checkpoints'),
}))
vi.mock('../adapters/sqlite-legacy-provider-rename-migration', () => ({
  migrateLegacyProviderReferences: recorded('provider references'),
}))
vi.mock('../adapters/pi/mcp/openwaggle-mcp-migration', () => ({
  migrateOpenWaggleMcpFilesAtHostStart: async () => {
    started.push('mcp files')
  },
  migrateOpenWaggleMcpSignInsAfterHostStart: async () => {
    started.push('mcp sign-ins')
  },
  stopOpenWaggleMcpSignInMigration: async () => {
    started.push('mcp sign-ins stopped')
  },
}))
vi.mock('../adapters/pi/pi-legacy-provider-credentials', () => ({
  migrateLegacyProviderCredentialsOnHostStart: recorded('provider credentials'),
}))

const {
  startHostBackgroundServices,
  startHostServicesAfterListening,
  stopHostServicesAfterListening,
} = await import('../runtime-host-services')

describe('Host background services', () => {
  it('starts the startup scratch sweep with the other Host services', async () => {
    // The mocked services need none of the Host's real dependencies.
    const services = fromPartial<
      Context.Context<Effect.Effect.Context<ReturnType<typeof startHostBackgroundServices>>>
    >(Context.empty())
    await Effect.runPromise(
      startHostBackgroundServices({
        createDiscoveredSession: () => Effect.succeed(null),
      }).pipe(Effect.provide(services)),
    )

    // Removes scratch directories of Sessions deleted or archived while no Host ran (ADR 0042).
    expect(started).toContain('scratch sweep')
    expect(started).toContain('tool gateway')
    // Releases Follow-up edit holds whose lease ran out so their queues deliver again (ADR 0044).
    expect(started).toContain('follow-up edit hold expiry')
    // Carries stored model references and credentials across Pi 1.0.3's Azure provider rename
    // before any service resolves them.
    expect(started.indexOf('provider references')).toBeLessThan(started.indexOf('tool gateway'))
    expect(started.indexOf('provider credentials')).toBeLessThan(started.indexOf('tool gateway'))
    expect(started).toContain('provider references')
    expect(started).toContain('provider credentials')
    // Migrates pre-ADR-0051 MCP files before Settings, the CLI, or a Run reads them.
    expect(started.indexOf('mcp files')).toBeGreaterThanOrEqual(0)
    expect(started.indexOf('mcp files')).toBeLessThan(started.indexOf('tool gateway'))
    // Fires due Scheduled tasks and holds the Host open while one is enabled (ADR 0057).
    expect(started.indexOf('scheduled tasks')).toBeGreaterThan(started.indexOf('tool gateway'))
    // Lists `pi` CLI sessions created in OpenWaggle projects (ADR 0051).
    expect(started).toContain('pi session discovery')
    // WAL checkpoints leave the Host's event loop before any service writes (#357).
    expect(started[0]).toBe('wal checkpoints')
    // Old MCP sign-ins read the keychain, which can stall for minutes: not part of Host start.
    expect(started).not.toContain('mcp sign-ins')
  })

  it('migrates old MCP sign-ins once the Host serves clients', async () => {
    started.length = 0

    await startHostServicesAfterListening()

    expect(started).toEqual(['mcp sign-ins'])
  })

  it('stops the MCP sign-in migration at Host stop', async () => {
    started.length = 0

    await stopHostServicesAfterListening()

    expect(started).toEqual(['mcp sign-ins stopped'])
  })
})
