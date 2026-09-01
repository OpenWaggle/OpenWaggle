import { describe, expect, it, vi } from 'vitest'
import type { CompleteLiveQaCleanupInput } from '../live-session-orchestration-lifecycle'
import {
  assertPackagedSemanticSearch,
  runPackagedSessionHostStartupScenario,
} from '../packaged-session-host-startup-smoke'

function rethrowPrimaryFailure(input: CompleteLiveQaCleanupInput) {
  if (input.primaryFailure !== null) throw input.primaryFailure.error
  return Promise.resolve()
}

describe('packaged Session Host startup smoke', () => {
  it('requires a ready semantic backend and the migrated Session', () => {
    expect(() =>
      assertPackagedSemanticSearch({
        operation: 'search',
        searchBackend: 'semantic',
        semanticReadiness: { status: 'ready' },
        sessions: [{ sessionId: 'packaged-cutover-session' }],
      }),
    ).not.toThrow()

    expect(() =>
      assertPackagedSemanticSearch({
        operation: 'search',
        searchBackend: 'lexical',
        semanticReadiness: { status: 'unavailable' },
        sessions: [{ sessionId: 'packaged-cutover-session' }],
      }),
    ).toThrow('packaged semantic embedding/search smoke')
  })

  it('routes legacy database seeding failures through retained-profile cleanup', async () => {
    const seedFailure = new Error('legacy seed failed')
    const cleanup = vi.fn(rethrowPrimaryFailure)

    await expect(
      runPackagedSessionHostStartupScenario(
        {
          executable: '/packaged/OpenWaggle',
          scenario: 'legacy',
          userDataRoot: '/tmp/openwaggle-packaged-legacy',
        },
        {
          cleanup,
          seedLegacyDatabase: () => {
            throw seedFailure
          },
        },
      ),
    ).rejects.toBe(seedFailure)

    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        gui: null,
        passed: false,
        primaryFailure: { error: seedFailure },
        userDataRoot: '/tmp/openwaggle-packaged-legacy',
      }),
    )
  })

  it('routes CLI shim preparation failures through retained-profile cleanup', async () => {
    const shimFailure = new Error('CLI shim failed')
    const cleanup = vi.fn(rethrowPrimaryFailure)

    await expect(
      runPackagedSessionHostStartupScenario(
        {
          executable: '/packaged/OpenWaggle',
          scenario: 'fresh',
          userDataRoot: '/tmp/openwaggle-packaged-fresh',
        },
        {
          cleanup,
          prepareCliExecutable: async () => {
            throw shimFailure
          },
        },
      ),
    ).rejects.toBe(shimFailure)

    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        gui: null,
        passed: false,
        primaryFailure: { error: shimFailure },
        userDataRoot: '/tmp/openwaggle-packaged-fresh',
      }),
    )
  })
})
