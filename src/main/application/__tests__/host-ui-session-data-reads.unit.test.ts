import { MessageId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionContentWorkspace, SessionDetail, SessionNode } from '@shared/types/session'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'

vi.mock('../pi-session-projection-refresh', () => ({
  openedSessionId: (value: unknown) => Effect.succeed(SessionId(String(value))),
}))
vi.mock('../pi-session-deleted-files', () => ({
  withDeletedPiSessionFileNotice: (detail: unknown) => Effect.succeed(detail),
}))
vi.mock('../pi-session-prompt-origin', () => ({
  withPiSessionPromptOrigin: (detail: unknown) => Effect.succeed(detail),
}))
vi.mock('../local-session-command-dispatcher', () => ({ dispatchLocalSessionCommand: vi.fn() }))

const { dispatchHostBackedSessionGuiOperation } = await import(
  '../host-ui-session-operation-dispatcher'
)

const SESSION = SessionId('session-1')

function node(id: string, parentId: string | null, order: number): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: order,
    createdOrder: order,
    pathDepth: order,
    message: {
      id: MessageId(id),
      role: 'assistant',
      parts: [{ type: 'text', text: `answer ${id}` }],
      createdAt: order,
    },
    contentJson: '{"parts":[]}',
    metadataJson: '{}',
  }
}

const nodes = [node('a', null, 0), node('b', 'a', 1), node('c', 'b', 2)]
const workspace: SessionContentWorkspace = {
  tree: {
    session: { id: SESSION, title: 'S', projectPath: null, createdAt: 1, updatedAt: 2 },
    nodes,
    branches: [],
    branchStates: [],
    uiState: null,
  },
  activeBranchId: null,
  activeNodeId: SessionNodeId('c'),
  transcriptPath: nodes.map((entry) => ({ node: entry, isActive: entry.id === 'c' })),
}

function run<A>(
  effect: Effect.Effect<A, unknown, unknown>,
  services: {
    readonly sessions?: Partial<SessionRepositoryShape>
    readonly projections?: Partial<SessionProjectionRepositoryShape>
  },
) {
  const provided = effect.pipe(
    Effect.provideService(
      SessionRepository,
      fromPartial<SessionRepositoryShape>(services.sessions ?? {}),
    ),
    Effect.provideService(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepositoryShape>(services.projections ?? {}),
    ),
  )
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof provided>(provided))
}

describe('Host UI Session data reads (B5/D5)', () => {
  it('returns a content-free tree', async () => {
    const tree = await run(dispatchHostBackedSessionGuiOperation('sessions:get-tree', [SESSION]), {
      sessions: { getTree: () => Effect.succeed(workspace.tree) },
    })

    expect(tree?.nodes.map((entry) => Object.keys(entry).includes('message'))).toEqual([
      false,
      false,
      false,
    ])
    expect(tree?.nodes[0]?.preview).toBe('answer a')
  })

  it('reads the node mutation revision before the workspace it labels', async () => {
    const order: string[] = []
    const result = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-workspace', [
        SESSION,
        undefined,
        {
          window: { minEntries: 2 },
          cached: { nodeMutationRevision: 6, nodeIds: [SessionNodeId('b')] },
        },
      ]),
      {
        sessions: {
          getNodeMutationRevision: () =>
            Effect.sync(() => {
              order.push('revision')
              return 6
            }),
          getWorkspace: () =>
            Effect.sync(() => {
              order.push('workspace')
              return workspace
            }),
        },
      },
    )

    expect(order).toEqual(['revision', 'workspace'])
    expect(result?.transcriptWindow).toEqual({ startIndex: 1, pathLength: 3 })
    expect(result?.transcriptPath.map((entry) => entry.contentOmitted === true)).toEqual([
      true,
      false,
    ])
    expect(result?.nodeMutationRevision).toBe(6)
  })

  it('refuses a malformed workspace request', async () => {
    await expect(
      run(
        dispatchHostBackedSessionGuiOperation('sessions:get-workspace', [
          SESSION,
          undefined,
          fromAny({ window: { minEntries: -1 } }),
        ]),
        { sessions: { getWorkspace: () => Effect.succeed(workspace) } },
      ),
    ).rejects.toThrow(/Session workspace request is invalid/)
  })

  it('returns only appended messages for a detail cursor', async () => {
    const detail: SessionDetail = {
      id: SESSION,
      title: 'S',
      projectPath: null,
      messages: nodes.flatMap((entry) => (entry.message ? [entry.message] : [])),
      createdAt: 1,
      updatedAt: 2,
    }
    const result = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [
        SESSION,
        { nodeMutationRevision: 2, messageCount: 2, lastMessageId: 'b' },
      ]),
      {
        sessions: { getNodeMutationRevision: () => Effect.succeed(2) },
        projections: { getOptional: () => Effect.succeed(detail) },
      },
    )

    expect(result?.messages.map((message) => String(message.id))).toEqual(['c'])
    expect(result?.messagesDelta).toEqual({ baseMessageCount: 2 })
  })

  it('reads a detail without a cursor as before, without a revision read', async () => {
    const getNodeMutationRevision = vi.fn(() => Effect.succeed(2))
    const detail = fromPartial<SessionDetail>({ id: SESSION, messages: [] })
    const result = await run(
      dispatchHostBackedSessionGuiOperation('sessions:get-detail', [SESSION]),
      {
        sessions: { getNodeMutationRevision },
        projections: { getOptional: () => Effect.succeed(detail) },
      },
    )

    expect(result).toBe(detail)
    expect(getNodeMutationRevision).not.toHaveBeenCalled()
  })

  it('searches the tree on the Host', async () => {
    const searchTreeNodes = vi.fn(() => Effect.succeed([SessionNodeId('b')]))
    const result = await run(
      dispatchHostBackedSessionGuiOperation('sessions:search-tree', [SESSION, 'needle']),
      { sessions: { searchTreeNodes } },
    )

    expect(result).toEqual([SessionNodeId('b')])
    expect(searchTreeNodes).toHaveBeenCalledWith(SESSION, 'needle')
  })

  it('reads every requested turn’s changed files in one repository call', async () => {
    const listTurnDiffFiles = vi.fn(() => Effect.succeed({ t1: [], t2: [] }))
    const result = await run(
      dispatchHostBackedSessionGuiOperation('sessions:turn-diff-files:list', [
        SESSION,
        ['t1', 't2'],
      ]),
      { projections: { listTurnDiffFiles } },
    )

    expect(result).toEqual({ t1: [], t2: [] })
    expect(listTurnDiffFiles).toHaveBeenCalledTimes(1)
    expect(listTurnDiffFiles).toHaveBeenCalledWith(SESSION, ['t1', 't2'])
  })
})
