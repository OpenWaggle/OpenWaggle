import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppServices } from '../../../runtime'

/**
 * Pi session discovery (ADR 0048): a session the `pi` CLI created inside an OpenWaggle project is
 * listed as a Session, projected when opened, and projected again when Pi changed it meanwhile.
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

let root = ''
let project = ''

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-discovery-')))
  state.userDataDir = path.join(root, 'user-data')
  project = path.join(root, 'projects', 'app')
  await fs.mkdir(path.join(project, 'packages', 'core'), { recursive: true })
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'pi-agent'))
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

function assistantReply(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

/** What the `pi` CLI leaves behind after one exchange in `cwd`. */
function createPiCliSession(cwd: string, prompt: string) {
  const sessionManager = SessionManager.create(cwd)
  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  })
  sessionManager.appendMessage(assistantReply(`Answer to: ${prompt}`))
  const file = sessionManager.getSessionFile()
  if (!file) throw new Error('Pi did not create a session file.')
  return { id: sessionManager.getSessionId(), file }
}

/** The CLI continuing the same session, as `pi --resume` would. */
function continuePiCliSession(file: string, prompt: string) {
  const sessionManager = SessionManager.open(file)
  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  })
  sessionManager.appendMessage(assistantReply(`Answer to: ${prompt}`))
}

async function run<A, E>(effect: Effect.Effect<A, E, AppServices>) {
  const { runAppEffect } = await import('../../../runtime')
  return runAppEffect(effect)
}

async function useProjects(projectPaths: readonly string[]) {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ recentProjects: [...projectPaths] }),
    ),
  )
}

async function discover() {
  const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
  return run(discoverPiSessions())
}

async function openSession(sessionId: string) {
  const { refreshPiSessionProjection } = await import('../../../application/pi-session-discovery')
  return run(refreshPiSessionProjection(SessionId(sessionId), 'reader'))
}

async function sessionDetail(sessionId: string) {
  const { SessionProjectionRepository } = await import(
    '../../../ports/session-projection-repository'
  )
  return run(
    Effect.flatMap(SessionProjectionRepository, (repository) =>
      repository.getOptional(SessionId(sessionId)),
    ),
  )
}

function messageTexts(detail: Awaited<ReturnType<typeof sessionDetail>>) {
  return (detail?.messages ?? []).flatMap((message) =>
    message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )
}

describe('Pi session discovery', () => {
  it('lists a Pi CLI session from a folder inside a project once, bound to the project', async () => {
    await useProjects([project])
    const cli = createPiCliSession(path.join(project, 'packages', 'core'), 'Explain the parser')
    createPiCliSession(path.join(root, 'projects', 'other'), 'Not in a project')

    expect(await discover()).toEqual([SessionId(cli.id)])
    expect(await discover()).toEqual([])

    const detail = await sessionDetail(cli.id)
    expect(detail).toMatchObject({
      id: SessionId(cli.id),
      projectPath: project,
      piSessionId: cli.id,
      piSessionFile: cli.file,
      title: 'Explain the parser',
    })
    expect(detail?.messages).toEqual([])
  })

  it('projects the transcript the first time the Session is opened', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'Add a changelog')
    await discover()

    expect(await openSession(cli.id)).toBe('projected')

    expect(messageTexts(await sessionDetail(cli.id))).toEqual([
      'Add a changelog',
      'Answer to: Add a changelog',
    ])
    expect(await openSession(cli.id)).toBe('fresh')
  })

  it('projects again after the Pi CLI continued the session', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'First question')
    await discover()
    await openSession(cli.id)

    continuePiCliSession(cli.file, 'Second question')

    expect(await openSession(cli.id)).toBe('projected')
    expect(messageTexts(await sessionDetail(cli.id))).toEqual([
      'First question',
      'Answer to: First question',
      'Second question',
      'Answer to: Second question',
    ])
  })

  it('does not list a Pi session OpenWaggle already has, or one it is deleting', async () => {
    await useProjects([project])
    const own = createPiCliSession(project, 'Started in OpenWaggle')
    const deleting = createPiCliSession(project, 'Being deleted')
    const { SessionProjectionRepository } = await import(
      '../../../ports/session-projection-repository'
    )
    await run(
      Effect.flatMap(SessionProjectionRepository, (repository) =>
        repository.create({ projectPath: project, piSessionId: own.id, piSessionFile: own.file }),
      ),
    )
    await discover()
    const { prepareSessionDeletion } = await import('../../../store/session-details')
    await prepareSessionDeletion(SessionId(deleting.id))

    // The deleted Session's row is gone before its Pi file is.
    const { runStoreEffect } = await import('../../../store/store-runtime')
    const SqlClient = await import('@effect/sql/SqlClient')
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`DELETE FROM sessions WHERE id = ${deleting.id}`,
      ),
    )

    expect(await discover()).toEqual([])
  })

  it('keeps the projection a Run persisted without reading the file again', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'Question')
    await discover()
    await openSession(cli.id)
    continuePiCliSession(cli.file, 'Asked from OpenWaggle')

    // What a Run persists after Pi wrote its turn to the file.
    const { projectPiSessionSnapshot } = await import('../agent-kernel/session-projection')
    const snapshot = projectPiSessionSnapshot({ sessionManager: SessionManager.open(cli.file) })
    const { SessionRepository } = await import('../../../ports/session-repository')
    await run(
      Effect.flatMap(SessionRepository, (repository) =>
        repository.persistSnapshot({
          sessionId: SessionId(cli.id),
          nodes: snapshot.nodes,
          activeNodeId: snapshot.activeNodeId,
          piSessionId: cli.id,
          piSessionFile: cli.file,
        }),
      ),
    )

    expect(await openSession(cli.id)).toBe('fresh')
  })

  it('shows the transcript when the sidebar opens a discovered Session', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'Open me from the sidebar')
    await discover()
    const { dispatchHostBackedSessionGuiOperation } = await import(
      '../../../application/host-ui-session-operation-dispatcher'
    )

    const workspace = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-workspace', [SessionId(cli.id)]),
    )

    expect(workspace?.tree.nodes.length).toBe(2)
    expect(messageTexts(await sessionDetail(cli.id))).toEqual([
      'Open me from the sidebar',
      'Answer to: Open me from the sidebar',
    ])
  })

  it('keeps the selected position when the file was touched but not changed', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'Pick an earlier message')
    await discover()
    await openSession(cli.id)
    const { SessionRepository } = await import('../../../ports/session-repository')
    const tree = await run(
      Effect.flatMap(SessionRepository, (repository) => repository.getTree(SessionId(cli.id))),
    )
    const firstNodeId = tree?.nodes.find((node) => node.parentId === null)?.id
    expect(firstNodeId).toBeDefined()
    const { runStoreEffect } = await import('../../../store/store-runtime')
    const SqlClient = await import('@effect/sql/SqlClient')
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`UPDATE sessions SET last_active_node_id = ${String(firstNodeId)} WHERE id = ${cli.id}`,
      ),
    )
    const later = new Date(Date.now() + 60_000)
    await fs.utimes(cli.file, later, later)

    expect(await openSession(cli.id)).toBe('unchanged')
    expect((await sessionDetail(cli.id))?.resumePosition?.nodeId).toBe(firstNodeId)
    expect(await openSession(cli.id)).toBe('fresh')
  })

  it('leaves a Session to the writer that owns it', async () => {
    await useProjects([project])
    const cli = createPiCliSession(project, 'Busy session')
    await discover()
    const { reserveSessionTreeMutation } = await import('../../../application/active-session-runs')
    const writer = reserveSessionTreeMutation(SessionId(cli.id))
    try {
      expect(await openSession(cli.id)).toBe('busy')
    } finally {
      writer.release()
    }
    expect(await openSession(cli.id)).toBe('projected')
  })
})
