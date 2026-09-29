import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { prepareSessionScratchDirectory } from '../../utils/session-scratch-directory'
import { installSessionHostEventRuntime, publishSessionHostEvent } from '../session-host-events'

async function waitForRemoval(directory: string) {
  await vi.waitFor(async () => {
    await expect(fs.access(directory)).rejects.toThrow()
  })
}

describe('Session Host scratch directory cleanup', () => {
  let temporaryDirectory = ''
  let releaseRuntime: (() => void) | undefined
  let liveness: SessionHostLiveness | undefined

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scratch-cleanup-'))
    vi.spyOn(os, 'tmpdir').mockReturnValue(temporaryDirectory)
    liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: () => undefined,
    })
    releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
  })

  afterEach(async () => {
    releaseRuntime?.()
    liveness?.close()
    vi.restoreAllMocks()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it.each(['archived', 'deleted'] as const)(
    'removes the scratch directory when a Session is %s',
    async (change) => {
      const directory = await prepareSessionScratchDirectory('session-a')
      const sibling = await prepareSessionScratchDirectory('session-b')
      await fs.writeFile(path.join(directory, 'push.log'), 'output')

      publishSessionHostEvent({ kind: 'session-list-changed', sessionId: 'session-a', change })

      await waitForRemoval(directory)
      await expect(fs.stat(sibling)).resolves.toBeDefined()
    },
  )

  it.each(['created', 'updated', 'unarchived'] as const)(
    'keeps the scratch directory when a Session is %s',
    async (change) => {
      const directory = await prepareSessionScratchDirectory('session-a')
      // A later removal that has finished shows any earlier one would have too.
      const marker = await prepareSessionScratchDirectory('session-marker')

      publishSessionHostEvent({ kind: 'session-list-changed', sessionId: 'session-a', change })
      publishSessionHostEvent({
        kind: 'session-list-changed',
        sessionId: 'session-marker',
        change: 'deleted',
      })
      await waitForRemoval(marker)

      await expect(fs.stat(directory)).resolves.toBeDefined()
    },
  )
})
