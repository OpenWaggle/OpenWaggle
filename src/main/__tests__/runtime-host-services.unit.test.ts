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
vi.mock('../adapters/session-semantic-discovery-background', () => ({
  runSessionSemanticDiscoveryBackground: recorded('semantic discovery'),
}))
vi.mock('../store/session-details/snapshot-transcript-term-projection', () => ({
  runTranscriptTermRepairBackground: recorded('transcript term repair'),
}))
vi.mock('../application/extension-trusted-main-activation-service', () => ({
  activateTrustedMainExtensionsForActiveProjectSafely: () => recorded('trusted extensions'),
}))

const { startHostBackgroundServices } = await import('../runtime-host-services')

describe('Host background services', () => {
  it('starts the startup scratch sweep with the other Host services', async () => {
    // The mocked services need none of the Host's real dependencies.
    const services = fromPartial<
      Context.Context<Effect.Effect.Context<typeof startHostBackgroundServices>>
    >(Context.empty())
    await Effect.runPromise(startHostBackgroundServices.pipe(Effect.provide(services)))

    // Removes scratch directories of Sessions deleted or archived while no Host ran (ADR 0042).
    expect(started).toContain('scratch sweep')
    expect(started).toContain('tool gateway')
  })
})
