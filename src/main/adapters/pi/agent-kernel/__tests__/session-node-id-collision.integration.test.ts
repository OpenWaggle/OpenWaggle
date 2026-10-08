import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository } from '../../../../ports/session-repository'
import { SqliteSessionRepositoryLive } from '../../../sqlite-session-repository'
import { projectPiSessionSnapshot } from '../session-projection'
import { PiSessionTranscriptRepairLive } from '../snapshot-entry-id-repair'

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

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function appendTurn(sessionManager: SessionManager, text: string, timestamp: number) {
  sessionManager.appendMessage({ role: 'user', content: text, timestamp })
  return sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${text} answer` }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: timestamp + 1,
  })
}

let projectPath = ''

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-node-id-collision-'))
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-node-id-collision-project-'))
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
  await fs.rm(projectPath, { recursive: true, force: true })
})

function runWithRepository<A, E>(effect: Effect.Effect<A, E, SessionRepository>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        SqliteSessionRepositoryLive.pipe(Layer.provide(PiSessionTranscriptRepairLive)),
      ),
    ),
  )
}

async function readLines(file: string) {
  const text = await fs.readFile(file, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): { id?: string; type: string; parentId?: string | null } => JSON.parse(line))
}

/** Rewrites one entry id of a Pi file, as Pi's eight-character ids could collide on their own. */
async function renameEntry(file: string, from: string, to: string) {
  const lines = await readLines(file)
  const renamed = lines.map((line) => ({
    ...line,
    ...(line.id === from ? { id: to } : {}),
    ...(line.parentId === from ? { parentId: to } : {}),
  }))
  await fs.writeFile(file, `${renamed.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

async function createProjectedSession(sessionManager: SessionManager) {
  const { createSession } = await import('../../../../store/session-details')
  const piSessionFile = sessionManager.getSessionFile() ?? ''
  const session = await createSession({
    projectPath,
    piSessionId: sessionManager.getSessionId(),
    piSessionFile,
  })
  return { sessionId: SessionId(String(session.id)), piSessionFile }
}

function persist(sessionId: SessionId, sessionManager: SessionManager) {
  const snapshot = projectPiSessionSnapshot({ sessionManager })
  return runWithRepository(
    Effect.gen(function* () {
      const repository = yield* SessionRepository
      yield* repository.persistSnapshot({
        sessionId,
        nodes: snapshot.nodes,
        activeNodeId: snapshot.activeNodeId,
        piSessionId: sessionManager.getSessionId(),
        piSessionFile: sessionManager.getSessionFile(),
      })
    }),
  )
}

function treeOf(sessionId: SessionId) {
  return runWithRepository(
    Effect.gen(function* () {
      const repository = yield* SessionRepository
      return yield* repository.getTree(sessionId)
    }),
  )
}

describe('Session node ids shared with another Session', () => {
  it('mints full UUID entry ids, which cannot equal an eight-character id', () => {
    const pi = SessionManager.create(projectPath, projectPath)
    const id = appendTurn(pi, 'first', 1)

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  })

  it('saves a Session whose Pi file reuses another Session node id, and keeps both intact', async () => {
    const owner = SessionManager.create(projectPath, projectPath)
    const ownerHead = appendTurn(owner, 'owner', 1)
    const ownerSession = await createProjectedSession(owner)
    await persist(ownerSession.sessionId, owner)

    // The colliding Session saved two turns, then Pi wrote an entry with the owner's id.
    const collider = SessionManager.create(projectPath, projectPath)
    appendTurn(collider, 'first', 10)
    const colliderSession = await createProjectedSession(collider)
    await persist(colliderSession.sessionId, collider)
    const collidingId = appendTurn(collider, 'second', 20)
    appendTurn(collider, 'third', 30)
    await renameEntry(colliderSession.piSessionFile, collidingId, ownerHead)
    const reopened = SessionManager.open(colliderSession.piSessionFile, undefined, projectPath)
    expect(reopened.getEntry(ownerHead)).toBeDefined()

    await persist(colliderSession.sessionId, reopened)

    const ownerTree = await treeOf(ownerSession.sessionId)
    const colliderTree = await treeOf(colliderSession.sessionId)
    expect(ownerTree?.nodes.map((node) => node.id)).toContain(ownerHead)
    expect(colliderTree?.nodes.map((node) => node.id)).not.toContain(ownerHead)
    // Every Pi entry is projected, including the turns after the collision.
    expect(colliderTree?.nodes).toHaveLength(reopened.getEntries().length)

    // The file was renamed consistently: one tree, no dangling parent, no owner id.
    const lines = await readLines(colliderSession.piSessionFile)
    const ids = new Set(lines.flatMap((line) => (line.type === 'session' ? [] : [line.id])))
    expect(ids.has(ownerHead)).toBe(false)
    for (const line of lines) {
      if (line.type !== 'session' && line.parentId) expect(ids.has(line.parentId)).toBe(true)
    }
    const projectedIds = new Set(colliderTree?.nodes.map((node) => String(node.id)))
    expect(projectedIds).toEqual(ids)

    // A later turn appends to the renamed file and saves normally.
    const next = SessionManager.open(colliderSession.piSessionFile, undefined, projectPath)
    appendTurn(next, 'fourth', 40)
    await persist(colliderSession.sessionId, next)
    expect((await treeOf(colliderSession.sessionId))?.nodes).toHaveLength(next.getEntries().length)
  })

  it('rewrites references to a renamed entry and moves projection-only children with it', async () => {
    const owner = SessionManager.create(projectPath, projectPath)
    const ownerHead = appendTurn(owner, 'owner', 1)
    const ownerSession = await createProjectedSession(owner)
    await persist(ownerSession.sessionId, owner)

    const collider = SessionManager.create(projectPath, projectPath)
    const collidingId = appendTurn(collider, 'first', 10)
    collider.appendLabelChange(collidingId, 'important')
    const colliderSession = await createProjectedSession(collider)
    await renameEntry(colliderSession.piSessionFile, collidingId, ownerHead)
    const lines = await readLines(colliderSession.piSessionFile)
    await fs.writeFile(
      colliderSession.piSessionFile,
      `${lines
        .map((line) =>
          JSON.stringify(
            'targetId' in line && line.targetId === collidingId
              ? { ...line, targetId: ownerHead }
              : line,
          ),
        )
        .join('\n')}\n`,
      'utf8',
    )
    const reopened = SessionManager.open(colliderSession.piSessionFile, undefined, projectPath)
    const snapshot = projectPiSessionSnapshot({ sessionManager: reopened })
    // A durable agent-loop event lives only in the projection, as a child of the colliding entry.
    const template = snapshot.nodes[0]
    if (!template) throw new Error('Snapshot has no nodes')
    const auditNode = {
      ...template,
      id: 'run-1:agent-loop:0',
      parentId: ownerHead,
      piEntryType: 'custom',
      kind: 'custom' as const,
      role: null,
      contentJson: JSON.stringify({ customType: 'openwaggle.agent-loop.event', data: {} }),
      metadataJson: '{}',
      createdOrder: snapshot.nodes.length,
    }

    await runWithRepository(
      Effect.gen(function* () {
        const repository = yield* SessionRepository
        yield* repository.persistSnapshot({
          sessionId: colliderSession.sessionId,
          nodes: [...snapshot.nodes, auditNode],
          activeNodeId: ownerHead,
          piSessionId: reopened.getSessionId(),
          piSessionFile: colliderSession.piSessionFile,
        })
      }),
    )

    const renamed = SessionManager.open(colliderSession.piSessionFile, undefined, projectPath)
    const renamedId = renamed
      .getEntries()
      .find((entry) => entry.type === 'message' && entry.message.role === 'assistant')?.id
    expect(renamedId).toBeDefined()
    expect(renamedId).not.toBe(ownerHead)
    const label = renamed.getEntries().find((entry) => entry.type === 'label')
    expect(label && 'targetId' in label ? label.targetId : undefined).toBe(renamedId)
    const tree = await treeOf(colliderSession.sessionId)
    const audit = tree?.nodes.find((node) => node.id === 'run-1:agent-loop:0')
    expect(audit?.parentId).toBe(renamedId)
    expect(tree?.nodes.map((node) => node.id)).not.toContain(ownerHead)
    expect((await treeOf(ownerSession.sessionId))?.nodes.map((node) => node.id)).toContain(
      ownerHead,
    )
  })

  it('leaves a Pi file it cannot parse untouched and reports the conflict', async () => {
    const owner = SessionManager.create(projectPath, projectPath)
    const ownerHead = appendTurn(owner, 'owner', 1)
    const ownerSession = await createProjectedSession(owner)
    await persist(ownerSession.sessionId, owner)

    const collider = SessionManager.create(projectPath, projectPath)
    const collidingId = appendTurn(collider, 'first', 10)
    const colliderSession = await createProjectedSession(collider)
    await renameEntry(colliderSession.piSessionFile, collidingId, ownerHead)
    const reopened = SessionManager.open(colliderSession.piSessionFile, undefined, projectPath)
    // A crash mid-append leaves a partial last line.
    await fs.appendFile(colliderSession.piSessionFile, '{"type":"message","id":"trunc', 'utf8')
    const before = await fs.readFile(colliderSession.piSessionFile, 'utf8')

    const failure = await runWithRepository(
      Effect.flip(
        Effect.gen(function* () {
          const repository = yield* SessionRepository
          const snapshot = projectPiSessionSnapshot({ sessionManager: reopened })
          yield* repository.persistSnapshot({
            sessionId: colliderSession.sessionId,
            nodes: snapshot.nodes,
            activeNodeId: snapshot.activeNodeId,
            piSessionId: reopened.getSessionId(),
            piSessionFile: colliderSession.piSessionFile,
          })
        }),
      ),
    )

    expect(String(failure.cause)).toContain(`${ownerHead} (Session ${ownerSession.sessionId})`)
    expect(await fs.readFile(colliderSession.piSessionFile, 'utf8')).toBe(before)
  })

  it('names the conflicting node and its owner when the snapshot cannot be repaired', async () => {
    const owner = SessionManager.create(projectPath, projectPath)
    const ownerHead = appendTurn(owner, 'owner', 1)
    const ownerSession = await createProjectedSession(owner)
    await persist(ownerSession.sessionId, owner)

    const collider = SessionManager.create(projectPath, projectPath)
    appendTurn(collider, 'first', 10)
    const colliderSession = await createProjectedSession(collider)
    const snapshot = projectPiSessionSnapshot({ sessionManager: collider })
    const lastNode = snapshot.nodes.at(-1)
    if (!lastNode) throw new Error('Snapshot has no nodes')

    // A projection-only node, not an entry of the Pi file, cannot be renamed in the file.
    const failure = await runWithRepository(
      Effect.gen(function* () {
        const repository = yield* SessionRepository
        return yield* Effect.flip(
          repository.persistSnapshot({
            sessionId: colliderSession.sessionId,
            nodes: [
              ...snapshot.nodes,
              {
                ...lastNode,
                id: ownerHead,
                parentId: lastNode.id,
                createdOrder: snapshot.nodes.length,
              },
            ],
            activeNodeId: snapshot.activeNodeId,
            piSessionId: collider.getSessionId(),
            piSessionFile: colliderSession.piSessionFile,
          }),
        )
      }),
    )

    expect(String(failure.cause)).toContain(`${ownerHead} (Session ${ownerSession.sessionId})`)
    expect((await treeOf(ownerSession.sessionId))?.nodes.map((node) => node.id)).toContain(
      ownerHead,
    )
  })
})
