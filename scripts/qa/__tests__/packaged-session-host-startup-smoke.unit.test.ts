import type { ChildProcess } from 'node:child_process'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { CompleteLiveQaCleanupInput } from '../live-session-orchestration-lifecycle'
import { trackWindowsProcessTreeThroughExit } from '../child-process-lifecycle'
import {
  assertPackagedSemanticSearch,
  runPackagedSessionHostStartupScenario,
} from '../packaged-session-host-startup-smoke'

function rethrowPrimaryFailure(input: CompleteLiveQaCleanupInput) {
  if (input.primaryFailure !== null) throw input.primaryFailure.error
  return Promise.resolve()
}

describe('packaged Session Host startup smoke', () => {
  it('fails closed when a Windows root exits before its identity can be observed', async () => {
    const child = fromPartial<ChildProcess>({ pid: 42, exitCode: 0, signalCode: null })

    await expect(
      trackWindowsProcessTreeThroughExit(child, {
        snapshotTree: async () => [],
        waitForExit: async () => undefined,
        waitBetweenSnapshots: async () => undefined,
      }),
    ).rejects.toThrow('descendant absence is unproven')
  })

  it('retains descendants discovered after the first Windows snapshot', async () => {
    const child = fromPartial<ChildProcess>({ pid: 43, exitCode: null, signalCode: null })
    let resolveExit: (() => void) | undefined
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    let snapshot = 0

    const identities = await trackWindowsProcessTreeThroughExit(child, {
      waitForExit: () => exit,
      waitBetweenSnapshots: async () => undefined,
      snapshotTree: async () => {
        snapshot += 1
        if (snapshot === 1) return [{ processId: 43, creationDate: 'root-created' }]
        if (snapshot === 2) {
          resolveExit?.()
          return [
            { processId: 43, creationDate: 'root-created' },
            { processId: 430, creationDate: 'descendant-created' },
          ]
        }
        return [{ processId: 430, creationDate: 'descendant-created' }]
      },
    })

    expect(identities).toEqual([
      { processId: 43, creationDate: 'root-created' },
      { processId: 430, creationDate: 'descendant-created' },
    ])
  })

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
