import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentKernelMissingEntryError } from '../../../../ports/agent-kernel-service'
import {
  compactPiSession,
  forkPiSession,
  getPiContextUsage,
  getPiSessionSnapshot,
  navigatePiSessionTree,
} from '../session-operations'

interface FakeSession {
  readonly sessionId: string
  readonly sessionFile: string
  readonly abortCompaction: () => void
  readonly compact: (instructions?: string) => Promise<{
    readonly summary: string
    readonly firstKeptEntryId: string
    readonly tokensBefore: number
  }>
  readonly getContextUsage: () =>
    | { readonly tokens: number; readonly contextWindow: number; readonly percent: number }
    | undefined
  readonly navigateTree: (
    targetNodeId: string,
    options: { readonly summarize: boolean; readonly customInstructions?: string },
  ) => Promise<{ readonly editorText?: string; readonly cancelled: boolean }>
  readonly subscribe: (listener: unknown) => () => void
}

type SessionOperation = (session: FakeSession) => unknown

const operationMocks = vi.hoisted(() => ({
  createPiSessionRuntime: vi.fn(),
  createSessionListener: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  projectPiSessionSnapshot: vi.fn(),
  withOpenWagglePiSessionLifecycleContext: vi.fn(),
  withPiSession: vi.fn(),
}))

vi.mock('../session-runtime', () => ({
  createPiSessionRuntime: operationMocks.createPiSessionRuntime,
  withPiSession: operationMocks.withPiSession,
}))

vi.mock('../../pi-session-lifecycle', () => ({
  disposeOpenWagglePiSession: operationMocks.disposeOpenWagglePiSession,
  withOpenWagglePiSessionLifecycleContext: operationMocks.withOpenWagglePiSessionLifecycleContext,
}))

vi.mock('../session-listener', () => ({
  createSessionListener: operationMocks.createSessionListener,
}))

vi.mock('../session-projection', () => ({
  projectPiSessionSnapshot: operationMocks.projectPiSessionSnapshot,
}))

const SESSION_ID = SessionId('session-operations')
const MODEL = SupportedModelId('openai/gpt-5.5')

function input() {
  return {
    session: {
      id: SESSION_ID,
      title: 'Session operations',
      projectPath: '/repo',
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    },
    model: MODEL,
  }
}

function createSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    sessionId: 'pi-session-1',
    sessionFile: '/repo/session.jsonl',
    abortCompaction: vi.fn(),
    compact: vi.fn(async () => ({
      summary: 'Compacted context',
      firstKeptEntryId: 'node-2',
      tokensBefore: 100,
    })),
    getContextUsage: vi.fn(() => ({ tokens: 40, contextWindow: 100, percent: 40 })),
    navigateTree: vi.fn(async () => ({ editorText: 'selected prompt', cancelled: false })),
    subscribe: vi.fn(() => vi.fn()),
    ...overrides,
  }
}

describe('Pi session operations', () => {
  let session: FakeSession

  beforeEach(() => {
    session = createSession()
    operationMocks.createPiSessionRuntime.mockReset()
    operationMocks.createSessionListener.mockReset()
    operationMocks.disposeOpenWagglePiSession.mockReset()
    operationMocks.projectPiSessionSnapshot.mockReset()
    operationMocks.withOpenWagglePiSessionLifecycleContext.mockReset()
    operationMocks.withPiSession.mockReset()
    operationMocks.projectPiSessionSnapshot.mockReturnValue({ activeNodeId: 'node-2', nodes: [] })
    operationMocks.withPiSession.mockImplementation(
      async (_input: unknown, operation: SessionOperation) => operation(session),
    )
    operationMocks.withOpenWagglePiSessionLifecycleContext.mockImplementation(
      async (_session: unknown, operation: () => Promise<unknown>) => operation(),
    )
  })

  it('maps Pi context usage and snapshots into OpenWaggle session results', async () => {
    await expect(getPiContextUsage(input())).resolves.toEqual({
      tokens: 40,
      contextWindow: 100,
      percent: 40,
    })
    await expect(getPiSessionSnapshot(input())).resolves.toEqual({
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      sessionSnapshot: { activeNodeId: 'node-2', nodes: [] },
    })
  })

  it('compacts with lifecycle events, abort wiring, and cleanup', async () => {
    const controller = new AbortController()
    controller.abort()
    const onEvent = vi.fn()

    const result = await compactPiSession({
      ...input(),
      customInstructions: 'keep recent decisions',
      signal: controller.signal,
      onEvent,
    })

    expect(session.subscribe).toHaveBeenCalledOnce()
    expect(operationMocks.createSessionListener).toHaveBeenCalledWith(
      { model: MODEL, onEvent },
      expect.any(String),
    )
    expect(session.abortCompaction).toHaveBeenCalledOnce()
    expect(session.compact).toHaveBeenCalledWith('keep recent decisions')
    expect(result).toEqual({
      summary: 'Compacted context',
      firstKeptEntryId: 'node-2',
      tokensBefore: 100,
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      sessionSnapshot: { activeNodeId: 'node-2', nodes: [] },
    })
  })

  it('navigates Pi session trees and maps missing entries to the port error', async () => {
    await expect(
      navigatePiSessionTree({
        ...input(),
        targetNodeId: 'node-2',
        summarize: true,
        customInstructions: 'summarize test context',
      }),
    ).resolves.toEqual({
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      sessionSnapshot: { activeNodeId: 'node-2', nodes: [] },
      editorText: 'selected prompt',
      cancelled: false,
    })
    expect(session.navigateTree).toHaveBeenCalledWith('node-2', {
      summarize: true,
      customInstructions: 'summarize test context',
    })

    session = createSession({
      navigateTree: vi.fn(async () => {
        throw new Error('Entry stale-node not found')
      }),
    })
    await expect(
      navigatePiSessionTree({ ...input(), targetNodeId: 'stale-node' }),
    ).rejects.toBeInstanceOf(AgentKernelMissingEntryError)
  })

  it('forks through the Pi runtime and disposes the session even when the target is invalid', async () => {
    const runtimeSession = { sessionId: 'pi-session-2', sessionFile: '/repo/fork.jsonl' }
    const fork = vi.fn(async () => ({ cancelled: false, selectedText: 'fork prompt' }))
    operationMocks.createPiSessionRuntime.mockResolvedValue({ session: runtimeSession, fork })

    await expect(
      forkPiSession({ ...input(), targetNodeId: 'node-2', position: 'at' }),
    ).resolves.toEqual({
      cancelled: false,
      piSessionId: 'pi-session-2',
      piSessionFile: '/repo/fork.jsonl',
      sessionSnapshot: { activeNodeId: 'node-2', nodes: [] },
      editorText: 'fork prompt',
    })
    expect(fork).toHaveBeenCalledWith('node-2', { position: 'at' })
    expect(operationMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(runtimeSession)

    const invalidFork = vi.fn(async () => {
      throw new Error('Invalid entry ID for forking')
    })
    operationMocks.createPiSessionRuntime.mockResolvedValue({
      session: runtimeSession,
      fork: invalidFork,
    })
    await expect(
      forkPiSession({ ...input(), targetNodeId: 'missing', position: 'before' }),
    ).rejects.toBeInstanceOf(AgentKernelMissingEntryError)
    expect(operationMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(runtimeSession)
  })
})
