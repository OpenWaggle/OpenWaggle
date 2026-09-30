import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rekeyForkedSessionLines } from '../fork-entry-identity'
import { forkPiSession } from '../session-operations'

const runtimeMocks = vi.hoisted(() => ({
  createPiSessionRuntime: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(async () => undefined),
}))

vi.mock('../session-runtime', () => ({
  createPiSessionRuntime: runtimeMocks.createPiSessionRuntime,
  withPiSession: vi.fn(),
}))

vi.mock('../../pi-session-lifecycle', () => ({
  disposeOpenWagglePiSession: runtimeMocks.disposeOpenWagglePiSession,
  withOpenWagglePiSessionLifecycleContext: (_session: unknown, operation: () => unknown) =>
    operation(),
}))

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

let directory = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-fork-identity-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function sourceSession() {
  const sessionManager = SessionManager.create(directory, directory)
  sessionManager.appendModelChange('provider', 'model')
  const firstUser = sessionManager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
  sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'first answer' }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: 2,
  })
  sessionManager.appendCompaction('summary', firstUser, 10)
  const secondUser = sessionManager.appendMessage({ role: 'user', content: 'second', timestamp: 3 })
  return { sessionManager, firstUser, secondUser }
}

/** A runtime whose fork is Pi's own: copy the path into a new session, keeping the entry ids. */
function mockForkRuntime(sessionManager: SessionManager, selectedText: string) {
  const runtimeSession: {
    sessionId: string
    sessionFile: string | undefined
    sessionManager: SessionManager
  } = { sessionId: 'source', sessionFile: sessionManager.getSessionFile(), sessionManager }
  const fork = vi.fn(async (targetNodeId: string, options: { readonly position: string }) => {
    const leaf =
      options.position === 'at' ? targetNodeId : sessionManager.getEntry(targetNodeId)?.parentId
    if (!leaf) throw new Error('The test forks below the first entry')
    runtimeSession.sessionFile = sessionManager.createBranchedSession(leaf)
    return { cancelled: false, selectedText }
  })
  runtimeMocks.createPiSessionRuntime.mockResolvedValue({
    cwd: directory,
    session: runtimeSession,
    fork,
  })
  return { fork, runtimeSession }
}

function forkInput(targetNodeId: string, position: 'at' | 'before') {
  return {
    session: {
      id: SessionId('source'),
      title: 'Source',
      projectPath: directory,
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    },
    model: SupportedModelId('provider/model'),
    targetNodeId,
    position,
  }
}

describe('forked Pi session identity', () => {
  it('re-keys every entry while keeping the tree and cross-entry references', () => {
    const lines = [
      { type: 'session', id: 'pi-session', cwd: '/repo' },
      { type: 'model_change', id: 'a', parentId: null },
      { type: 'message', id: 'b', parentId: 'a' },
      { type: 'compaction', id: 'c', parentId: 'b', firstKeptEntryId: 'b' },
      { type: 'branch_summary', id: 'd', parentId: 'c', fromId: 'outside-this-file' },
      { type: 'label', id: 'e', parentId: 'd', targetId: 'b' },
    ]

    const rekeyed = rekeyForkedSessionLines(lines)
    const entries = rekeyed.slice(1).map((line) => {
      if (typeof line !== 'object' || line === null) throw new Error('Expected an entry')
      return new Map(Object.entries(line))
    })
    const ids = entries.map((entry) => entry.get('id'))

    expect(rekeyed[0]).toEqual(lines[0])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(['a', 'b', 'c', 'd', 'e']).not.toContain(id)
    expect(entries.map((entry) => entry.get('parentId'))).toEqual([
      null,
      ids[0],
      ids[1],
      ids[2],
      ids[3],
    ])
    expect(entries[2]?.get('firstKeptEntryId')).toBe(ids[1])
    expect(entries[3]?.get('fromId')).toBe('outside-this-file')
    expect(entries[4]?.get('targetId')).toBe(ids[1])
  })

  it('returns a fork snapshot whose nodes do not reuse the source session ids', async () => {
    const { sessionManager, secondUser } = sourceSession()
    const sourceIds = new Set(sessionManager.getEntries().map((entry) => entry.id))
    const { fork, runtimeSession } = mockForkRuntime(sessionManager, 'second')

    const result = await forkPiSession(forkInput(secondUser, 'at'))

    const nodes = result.sessionSnapshot.nodes
    expect(fork).toHaveBeenCalledWith(secondUser, { position: 'at' })
    expect(runtimeMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(runtimeSession)
    expect(result).toMatchObject({ cancelled: false, editorText: 'second' })
    expect(nodes).toHaveLength(sourceIds.size)
    for (const node of nodes) expect(sourceIds.has(node.id)).toBe(false)
    const forkIds = new Set(nodes.map((node) => node.id))
    for (const node of nodes) {
      if (node.parentId !== null) expect(forkIds.has(node.parentId)).toBe(true)
    }
    expect(result.sessionSnapshot.activeNodeId).toBe(nodes.at(-1)?.id)

    const reopened = SessionManager.open(result.piSessionFile ?? '', undefined, directory)
    const compaction = reopened.getEntries().find((entry) => entry.type === 'compaction')
    expect(compaction?.type === 'compaction' && forkIds.has(compaction.firstKeptEntryId)).toBe(true)
  })

  it('saves a fork of the first message, which Pi has not written to disk', async () => {
    const { sessionManager, firstUser } = sourceSession()
    mockForkRuntime(sessionManager, 'first')

    const result = await forkPiSession(forkInput(firstUser, 'before'))

    // Only the model change precedes the first message, and Pi writes no file without a reply.
    expect(result).toMatchObject({ cancelled: false, editorText: 'first' })
    expect(result.sessionSnapshot.nodes.map((node) => node.kind)).toEqual(['model_change'])
    const reopened = SessionManager.open(result.piSessionFile ?? '', undefined, directory)
    expect(reopened.getEntries().map((entry) => entry.id)).toEqual(
      result.sessionSnapshot.nodes.map((node) => node.id),
    )
  })
})
