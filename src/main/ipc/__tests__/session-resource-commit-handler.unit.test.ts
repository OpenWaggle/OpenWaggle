import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
  type UpsertSessionResourceInput,
} from '../../ports/session-resource-repository'
import { registerSessionResourceHandlers } from '../session-resource-handler'

const mocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  getWorkspace: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({
        getWorkspace: (sessionId: SessionId) => Effect.sync(() => mocks.getWorkspace(sessionId)),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceRepository,
    SessionResourceRepository.of(
      fromPartial<SessionResourceRepositoryShape>({
        upsert: (input: UpsertSessionResourceInput) =>
          Effect.sync(() => {
            mocks.upsert(input)
            return {
              ...input,
              occurrences: [input.occurrence],
              isSource: false,
              isOutput: true,
            }
          }),
      }),
    ),
  ),
)

function invokeCommit(sessionId: unknown, input: unknown) {
  const handler = mocks.typedHandle.mock.calls.find(
    ([channel]) => channel === 'sessions:resources:record-commit',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Missing commit resource handler.')
  return Effect.runPromise(Effect.provide(handler({}, sessionId, input), TestLayer))
}

describe('session commit resource IPC handler', () => {
  beforeEach(() => {
    mocks.typedHandle.mockClear()
    mocks.getWorkspace.mockReset().mockReturnValue({
      activeNodeId: SessionNodeId('node-current'),
      activeBranchId: SessionBranchId('branch-main'),
    })
    mocks.upsert.mockReset()
    registerSessionResourceHandlers()
  })

  it('records a validated commit only in the requested session', async () => {
    await expect(
      invokeCommit(SessionId('session-one'), {
        commitHash: '0123456789abcdef0123456789abcdef01234567',
        title: 'Record the commit output',
      }),
    ).resolves.toMatchObject({
      sessionId: SessionId('session-one'),
      canonicalKey: 'git-commit:0123456789abcdef0123456789abcdef01234567',
      kind: 'commit',
      isOutput: true,
    })

    expect(mocks.getWorkspace).toHaveBeenCalledWith(SessionId('session-one'))
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SessionId('session-one'),
        occurrence: expect.objectContaining({
          nodeId: 'node-current',
          branchId: 'branch-main',
        }),
      }),
    )
  })

  it('rejects malformed commit hashes before recording a resource', () => {
    expect(() =>
      invokeCommit(SessionId('session-one'), {
        commitHash: '../HEAD',
        title: 'Invalid commit',
      }),
    ).toThrow()

    expect(mocks.getWorkspace).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
