import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import {
  configureSessionScratchNamespace,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  retainSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'
import { installSessionHostEventRuntime, publishSessionHostEvent } from '../session-host-events'

async function waitForRemoval(directory: string) {
  await vi.waitFor(async () => {
    await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
}

describe('Session Host scratch directory cleanup', () => {
  let releaseRuntime: (() => void) | undefined
  let liveness: SessionHostLiveness | undefined
  // The default root is shared, so each test uses Session ids nothing else can pick.
  let sessionA = ''
  let sessionB = ''
  let marker = ''
  let restoreNamespace: () => void = () => undefined

  beforeEach(() => {
    // An own namespace, removed afterwards, so the shared default one under /tmp is not left behind.
    restoreNamespace = configureSessionScratchNamespace(`scratch-cleanup-${randomUUID()}`)
    sessionA = `scratch-cleanup-${randomUUID()}`
    sessionB = `scratch-cleanup-${randomUUID()}`
    marker = `scratch-cleanup-${randomUUID()}`
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
    await Promise.all([sessionA, sessionB, marker].map((id) => removeSessionScratchDirectory(id)))
    await fs.rm(sessionScratchRoot(), { recursive: true, force: true })
    restoreNamespace()
  })

  it.each(['archived', 'deleted'] as const)(
    'removes the scratch directory when a Session is %s',
    async (change) => {
      const directory = await prepareSessionScratchDirectory(sessionA)
      const sibling = await prepareSessionScratchDirectory(sessionB)
      await fs.writeFile(path.join(directory, 'push.log'), 'output')

      publishSessionHostEvent({ kind: 'session-list-changed', sessionId: sessionA, change })

      await waitForRemoval(directory)
      await expect(fs.stat(sibling)).resolves.toBeDefined()
    },
  )

  it('keeps the directory of a Session archived mid-Run until that Run ends', async () => {
    const directory = await prepareSessionScratchDirectory(sessionA)
    const releaseRun = retainSessionScratchDirectory(sessionA)
    const markerDirectory = await prepareSessionScratchDirectory(marker)

    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: sessionA,
      change: 'archived',
    })
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId: marker, change: 'deleted' })
    await waitForRemoval(markerDirectory)
    await expect(fs.stat(directory)).resolves.toBeDefined()

    await releaseRun()
    await waitForRemoval(directory)
  })

  it('keeps the directory when a Session archived mid-Run is unarchived before the Run ends', async () => {
    const directory = await prepareSessionScratchDirectory(sessionA)
    const releaseRun = retainSessionScratchDirectory(sessionA)

    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: sessionA,
      change: 'archived',
    })
    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: sessionA,
      change: 'unarchived',
    })
    await releaseRun()

    expect((await fs.stat(directory)).isDirectory()).toBe(true)
  })

  it.each(['created', 'updated', 'unarchived'] as const)(
    'keeps the scratch directory when a Session is %s',
    async (change) => {
      const directory = await prepareSessionScratchDirectory(sessionA)
      // A later removal that has finished shows any earlier one would have too.
      const markerDirectory = await prepareSessionScratchDirectory(marker)

      publishSessionHostEvent({ kind: 'session-list-changed', sessionId: sessionA, change })
      publishSessionHostEvent({
        kind: 'session-list-changed',
        sessionId: marker,
        change: 'deleted',
      })
      await waitForRemoval(markerDirectory)

      await expect(fs.stat(directory)).resolves.toBeDefined()
    },
  )
})
