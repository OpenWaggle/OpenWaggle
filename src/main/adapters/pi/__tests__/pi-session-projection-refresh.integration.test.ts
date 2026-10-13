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
 * again before it is shown or continued when its Pi file changed outside OpenWaggle (ADR 0051).
 */

const { state, getPathMock, events } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
  events: new Array<{ kind: string; sessionId?: string; change?: string }>(),
}))

vi.mock('../../../session-host/session-host-events', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../session-host/session-host-events')>()
  return {
    ...original,
    publishSessionHostEvent: (event: Parameters<typeof original.publishSessionHostEvent>[0]) => {
      events.push(event)
      original.publishSessionHostEvent(event)
    },
  }
})

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

  it('remembers what it projected across a Host restart', async () => {
    await registerProjects([fixture.project])
    createPiCliSession(fixture.project, 'Survive a restart')
    const sessionId = await discoverOne()
    await openSession(sessionId)

    // A new Host process: nothing held in memory survives, only the database.
    const { disposeAppRuntime } = await import('../../../runtime')
    await disposeAppRuntime()
    vi.resetModules()

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

  it('shows what the Pi CLI added when the Session is opened, and says it changed', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'First question')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    continuePiCliSession(cli.file, 'Second question')
    events.length = 0
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )

    const opened = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [sessionId]),
    )

    expect(messageTexts(opened ?? null)).toEqual([
      'First question',
      'Answer to: First question',
      'Second question',
      'Answer to: Second question',
    ])
    // So a view that showed the Session before reads it again.
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'session-list-changed', sessionId, change: 'updated' }),
    )
  })

  it('keeps the projection a Run persisted without reading the file again', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Question')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    continuePiCliSession(cli.file, 'Asked from OpenWaggle')

    // What a Run persists after Pi wrote its turn to the file, under the Session's node ids.
    const { projectPiSessionSnapshot } = await import('../agent-kernel/session-projection')
    const { piEntryNodeIds } = await import('../agent-kernel/pi-entry-node-ids')
    const detail = await sessionDetail(sessionId)
    if (!detail?.piEntryNodeIdPrefix) throw new Error('A discovered Session has a node id prefix.')
    const snapshot = projectPiSessionSnapshot(
      { sessionManager: SessionManager.open(cli.file) },
      piEntryNodeIds(detail),
    )
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
    expect(messageTexts(await sessionDetail(sessionId))).toHaveLength(4)
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

  it('projects again when the file was rewritten in place with the same number of entries', async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Upgraded by pi --resume')
    const sessionId = await discoverOne()
    await openSession(sessionId)

    await rewriteWithNewEntryIds(cli.file)

    expect(await openSession(sessionId)).toBe('projected')
    expect(messageTexts(await sessionDetail(sessionId))).toEqual([
      'Upgraded by pi --resume',
      'Answer to: Upgraded by pi --resume',
    ])
  })
})

/** What `pi --resume` does when it upgrades an older file: the same entries under new ids. */
async function rewriteWithNewEntryIds(file: string) {
  const lines = (await fs.readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const renamed = new Map<string, string>()
  for (const line of lines) if (typeof line.id === 'string') renamed.set(line.id, `${line.id}-v2`)
  const rewritten = lines.map((line) =>
    line.type === 'session'
      ? line
      : {
          ...line,
          id: renamed.get(line.id),
          parentId: line.parentId === null ? null : (renamed.get(line.parentId) ?? line.parentId),
        },
  )
  await fs.writeFile(file, `${rewritten.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

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
