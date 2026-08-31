import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../../ports/session-resource-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
} from '../../ports/session-resource-store'
import { registerSessionResourceHandlers } from '../session-resource-handler'

const mocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  inspect: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))

const MANAGED_RESOURCE = {
  id: 'managed-attachment',
  sessionId: SessionId('session-one'),
  canonicalKey: 'sha256:managed',
  kind: 'file' as const,
  title: 'managed.txt',
  mimeType: 'text/plain',
  locator: 'session-resource://managed-attachment',
  available: true,
  isSource: true,
  isOutput: false,
  occurrences: [
    {
      id: 'session-one:node-one:provided:attachment:attachment-one:0',
      nodeId: 'node-one',
      branchId: null,
      actor: 'user' as const,
      activity: 'provided' as const,
      label: null,
      createdAt: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
}

const MANAGED_NODE = {
  id: 'node-one',
  branchId: null,
  message: {
    id: 'node-one',
    role: 'user' as const,
    parts: [
      {
        type: 'attachment' as const,
        attachment: {
          id: 'attachment-one',
          kind: 'text' as const,
          name: 'managed.txt',
          path: '/input/managed.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          extractedText: 'x',
        },
      },
    ],
    createdAt: 1,
  },
}

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({
        listResourceProjectionPage: () =>
          Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
        getTree: () => Effect.succeed({ nodes: [MANAGED_NODE] }),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceRepository,
    SessionResourceRepository.of(
      fromPartial<SessionResourceRepositoryShape>({
        list: () => Effect.succeed([MANAGED_RESOURCE]),
        getContentLocation: () =>
          Effect.succeed({
            resourceId: MANAGED_RESOURCE.id,
            sessionId: MANAGED_RESOURCE.sessionId,
            fileName: MANAGED_RESOURCE.title,
            mimeType: 'text/plain',
            managedPath: '/managed/managed.txt',
          }),
        getBackfillCursor: () => Effect.succeed(41),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceStore,
    SessionResourceStore.of(
      fromPartial<SessionResourceStoreShape>({
        inspect: (managedPath: string) => Effect.sync(() => mocks.inspect(managedPath)),
      }),
    ),
  ),
)

function invokeList() {
  const handler = mocks.typedHandle.mock.calls.find(
    ([channel]) => channel === 'sessions:resources:list',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Missing resource list handler.')
  return Effect.runPromise(Effect.provide(handler({}, SessionId('session-one')), TestLayer))
}

describe('completed session resource backfill', () => {
  beforeEach(() => {
    mocks.typedHandle.mockClear()
    mocks.inspect.mockReset().mockReturnValue(undefined)
    registerSessionResourceHandlers()
  })

  it('rechecks managed copies after the incremental cursor is complete', async () => {
    await expect(invokeList()).resolves.toEqual({
      resources: [MANAGED_RESOURCE],
      backfillComplete: true,
    })

    expect(mocks.inspect).toHaveBeenCalledWith('/managed/managed.txt')
  })
})
