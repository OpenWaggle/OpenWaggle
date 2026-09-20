import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { StoppableChild } from '../child-process-lifecycle'
import type { CompleteLiveQaCleanupInput } from '../live-session-orchestration-lifecycle'
import {
  assertPackagedSemanticSearch,
  packagedSecondInstanceArguments,
  runPackagedSessionHostStartupScenario,
} from '../packaged-session-host-startup-smoke'
import {
  assertSingleInstanceLockDeniedMarker,
  waitForNormalSecondInstanceExit,
} from '../single-instance-lock-proof'

function exitedChild(exitCode: number | null, signalCode: NodeJS.Signals | null): StoppableChild {
  return {
    exitCode,
    signalCode,
    kill: () => true,
    once() {
      return this
    },
    off() {
      return this
    },
  }
}

function rethrowPrimaryFailure(input: CompleteLiveQaCleanupInput) {
  if (input.primaryFailure !== null) throw input.primaryFailure.error
  return Promise.resolve()
}

describe('packaged Session Host startup smoke', () => {
  it('passes the explicit lock-denied marker on every POSIX platform', () => {
    const markerPath = path.join('/qa/profile', 'automation-single-instance-lock-denied')
    const markerArgument = `--openwaggle-automation-single-instance-lock-denied-marker=${markerPath}`

    expect(packagedSecondInstanceArguments('/qa/profile', 'darwin')).toEqual([markerArgument])
    expect(packagedSecondInstanceArguments('/qa/profile', 'linux')).toEqual([
      '--no-sandbox',
      markerArgument,
    ])
  })

  it('rejects a nonzero or signalled second-instance exit', async () => {
    await expect(waitForNormalSecondInstanceExit(exitedChild(1, null))).rejects.toThrow(
      'exited with code 1',
    )
    await expect(waitForNormalSecondInstanceExit(exitedChild(null, 'SIGTERM'))).rejects.toThrow(
      'exited from signal SIGTERM',
    )
  })

  it('observes an exit that races with listener registration', async () => {
    let exitCode: number | null = null
    const child: StoppableChild = {
      get exitCode() {
        return exitCode
      },
      signalCode: null,
      kill: () => true,
      once() {
        exitCode = 0
        return this
      },
      off() {
        return this
      },
    }

    await expect(waitForNormalSecondInstanceExit(child, 10)).resolves.toBeUndefined()
  })

  it('requires the exact lock-denied marker after a normal POSIX exit', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-posix-lock-proof-'))
    const markerPath = path.join(temporaryRoot, 'marker')
    try {
      await expect(waitForNormalSecondInstanceExit(exitedChild(0, null))).resolves.toBeUndefined()
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).rejects.toThrow(
        'did not prove single-instance lock denial',
      )
      await fs.writeFile(markerPath, 'wrong\n')
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).rejects.toThrow(
        'invalid single-instance lock-denied marker',
      )
      await fs.writeFile(markerPath, 'single-instance-lock-denied\n')
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).resolves.toBeUndefined()
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true })
    }
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
