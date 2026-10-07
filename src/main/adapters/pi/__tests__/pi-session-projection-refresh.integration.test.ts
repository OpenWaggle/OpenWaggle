import fs from 'node:fs/promises'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  continuePiCliSession,
  createPiCliSession,
  discoverOne,
  messageTexts,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * A discovered Pi session is projected the first time it is opened, and any Session is projected
 * again before it is shown or continued when its Pi file changed outside OpenWaggle (ADR 0048).
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const fixture = setUpPiDiscoveryFixture(state)

describe('Pi session projection refresh', () => {
  it('projects the transcript the first time the Session is opened', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Add a changelog')
    const sessionId = await discoverOne()

    expect(await openSession(sessionId)).toBe('projected')

    expect(messageTexts(await sessionDetail(sessionId))).toEqual([
      'Add a changelog',
      'Answer to: Add a changelog',
    ])
    expect(await openSession(sessionId)).toBe('fresh')
  })

  it('projects again after the Pi CLI continued the session', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'First question')
    const sessionId = await discoverOne()
    await openSession(sessionId)

    continuePiCliSession(cli.file, 'Second question')

    expect(await openSession(sessionId)).toBe('projected')
    expect(messageTexts(await sessionDetail(sessionId))).toEqual([
      'First question',
      'Answer to: First question',
      'Second question',
      'Answer to: Second question',
    ])
  })

  it('keeps the projection a Run persisted without reading the file again', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Question')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    continuePiCliSession(cli.file, 'Asked from OpenWaggle')

    // What a Run persists after Pi wrote its turn to the file.
    const { projectPiSessionSnapshot } = await import('../agent-kernel/session-projection')
    const snapshot = projectPiSessionSnapshot({ sessionManager: SessionManager.open(cli.file) })
    const { SessionRepository } = await import('../../../ports/session-repository')
    await run(
      Effect.flatMap(SessionRepository, (repository) =>
        repository.persistSnapshot({
          sessionId: sessionId,
          nodes: snapshot.nodes,
          activeNodeId: snapshot.activeNodeId,
          piSessionId: cli.id,
          piSessionFile: cli.file,
        }),
      ),
    )

    expect(await openSession(sessionId)).toBe('fresh')
  })

  it('shows the transcript when the sidebar opens a discovered Session', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Open me from the sidebar')
    const sessionId = await discoverOne()
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )

    const workspace = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-workspace', [sessionId]),
    )

    expect(workspace?.tree.nodes.length).toBe(2)
    expect(messageTexts(await sessionDetail(sessionId))).toEqual([
      'Open me from the sidebar',
      'Answer to: Open me from the sidebar',
    ])
  })

  it('keeps the selected position when the file was touched but not changed', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Pick an earlier message')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const { SessionRepository } = await import('../../../ports/session-repository')
    const tree = await run(
      Effect.flatMap(SessionRepository, (repository) => repository.getTree(sessionId)),
    )
    const firstNodeId = tree?.nodes.find((node) => node.parentId === null)?.id
    expect(firstNodeId).toBeDefined()
    const { runStoreEffect } = await import('../../../store/store-runtime')
    const SqlClient = await import('@effect/sql/SqlClient')
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`UPDATE sessions SET last_active_node_id = ${String(firstNodeId)} WHERE id = ${sessionId}`,
      ),
    )
    const later = new Date(Date.now() + 60_000)
    await fs.utimes(cli.file, later, later)

    expect(await openSession(sessionId)).toBe('unchanged')
    expect((await sessionDetail(sessionId))?.resumePosition?.nodeId).toBe(firstNodeId)
    expect(await openSession(sessionId)).toBe('fresh')
  })

  it('leaves a Session to the writer that owns it', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Busy session')
    const sessionId = await discoverOne()
    const { reserveSessionTreeMutation } = await import('../../../application/active-session-runs')
    const writer = reserveSessionTreeMutation(sessionId)
    try {
      expect(await openSession(sessionId)).toBe('busy')
    } finally {
      writer.release()
    }
    expect(await openSession(sessionId)).toBe('projected')
  })

  it('takes in what the Pi CLI added before a Run that owns the Session starts', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Before the Run')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    continuePiCliSession(cli.file, 'Added in the terminal')
    const { reserveSessionTreeMutation } = await import('../../../application/active-session-runs')
    const { loadSessionForRun } = await import('../../../application/pi-session-projection-refresh')

    const writer = reserveSessionTreeMutation(sessionId)
    try {
      const session = await run(loadSessionForRun(sessionId))
      expect(messageTexts(session)).toEqual([
        'Before the Run',
        'Answer to: Before the Run',
        'Added in the terminal',
        'Answer to: Added in the terminal',
      ])
      expect(session?.piSessionFile).toBe(cli.file)
    } finally {
      writer.release()
    }
  })

  it('keeps the projection and the Session order when only cache refreshes were appended', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Keep my place in the sidebar')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const before = await sessionDetail(sessionId)
    appendCacheRefresh(cli.file)
    appendCacheRefresh(cli.file)

    expect(await openSession(sessionId)).toBe('unchanged')
    const after = await sessionDetail(sessionId)
    expect(after?.updatedAt).toBe(before?.updatedAt)
    expect(messageTexts(after)).toEqual(messageTexts(before))
    expect(await openSession(sessionId)).toBe('fresh')

    continuePiCliSession(cli.file, 'A real turn after the refreshes')
    expect(await openSession(sessionId)).toBe('projected')
    expect(messageTexts(await sessionDetail(sessionId))).toContain(
      'A real turn after the refreshes',
    )
  })
})

/** What a warming session writes: a usage entry for one prompt cache refresh. */
function appendCacheRefresh(file: string) {
  SessionManager.open(file).appendUsage('cache_warm', 'test-provider', 'test-model', {
    input: 0,
    output: 1,
    cacheRead: 1200,
    cacheWrite: 0,
    totalTokens: 1201,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  })
}
