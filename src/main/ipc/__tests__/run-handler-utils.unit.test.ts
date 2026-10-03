import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { Message, PreparedAttachment } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { PINNED_SESSION_REPOSITORY_STUB } from '../../ports/__tests__/session-projection-pin-stub'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'

const {
  emitTransportEventMock,
  assignProvisionalTitleMock,
  requestInitialSessionTitleMock,
  hydrateAttachmentSourcesMock,
} = vi.hoisted(() => ({
  emitTransportEventMock: vi.fn(),
  assignProvisionalTitleMock: vi.fn<(id: unknown, title: string) => boolean>(() => true),
  requestInitialSessionTitleMock: vi.fn(),
  hydrateAttachmentSourcesMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}))

vi.mock('../../application/session-title-scheduler', () => ({
  requestInitialSessionTitle: requestInitialSessionTitleMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  emitErrorAndFinish(sessionId: unknown, message: string, code: string, runId = '') {
    emitTransportEventMock(sessionId, {
      type: 'agent_end',
      timestamp: Date.now(),
      runId,
      reason: 'error',
      error: { message, code },
    })
  },
}))

const makeTestSessionProjectionLayer = () =>
  Layer.succeed(SessionProjectionRepository, {
    get: (id) =>
      Effect.tryPromise({
        try: async () => makeSessionDetail({ id }),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
      }),
    getOptional: (id) =>
      Effect.tryPromise({
        try: async () => makeSessionDetail({ id }),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
      }),
    list: () => Effect.succeed([]),
    listDetails: () => Effect.succeed([]),
    create: () => Effect.succeed(makeSessionDetail()),
    delete: () => Effect.void,
    archive: () => Effect.void,
    unarchive: () => Effect.void,
    listArchived: () => Effect.succeed([]),
    updateTitle: () => Effect.void,
    assignProvisionalTitle: (id, title) => Effect.sync(() => assignProvisionalTitleMock(id, title)),
    setWorktreePlan: () => Effect.void,
    setAuthorizationMode: () => Effect.void,
    listTurnCheckpoints: () => Effect.succeed([]),
    getTurnDiff: () => Effect.succeed(null),
    getTurnDiffFiles: () => Effect.succeed([]),
    setTurnCheckpointAnchor: () => Effect.void,
    ...PINNED_SESSION_REPOSITORY_STUB,
  })

const TestRuntimeLayer = makeTestSessionProjectionLayer()

vi.mock('../../utils/attachment-hydration', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

import {
  assignSessionTitleFromUserText,
  emitErrorAndFinish,
  hydratePayloadAttachments,
} from '../run-handler-utils'

const CONV_ID = SessionId('test-conv-id')

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: MessageId('m1'),
    role: 'user',
    parts: [{ type: 'text', text: 'Existing' }],
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeSessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: CONV_ID,
    title: 'New session',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPath: '/test',
    ...overrides,
  }
}

function makeAttachment(overrides: Partial<PreparedAttachment> = {}): PreparedAttachment {
  return {
    id: 'a1',
    kind: 'text',
    name: 'test.txt',
    path: '/test.txt',
    mimeType: 'text/plain',
    sizeBytes: 100,
    extractedText: '',
    ...overrides,
  }
}

const TITLE_MODEL = SupportedModelId('openai/gpt-5')

function runTitleAssignment(
  session: SessionDetail,
  text: string,
  attachments: readonly PreparedAttachment[] = [],
) {
  return Effect.runPromise(
    Effect.provide(
      assignSessionTitleFromUserText(CONV_ID, session, { text, attachments, model: TITLE_MODEL }),
      TestRuntimeLayer,
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('emitErrorAndFinish', () => {
  it('emits an error terminal transport event', () => {
    emitErrorAndFinish(CONV_ID, 'Something broke', 'test-error')

    expect(emitTransportEventMock).toHaveBeenCalledTimes(1)

    const finishChunk = emitTransportEventMock.mock.calls[0]
    expect(finishChunk[0]).toBe(CONV_ID)
    expect(finishChunk[1].type).toBe('agent_end')
    expect(finishChunk[1].runId).toBe('')
    expect(finishChunk[1].reason).toBe('error')
    expect(finishChunk[1].error).toEqual({ message: 'Something broke', code: 'test-error' })
  })

  it('propagates optional runId', () => {
    emitErrorAndFinish(CONV_ID, 'Error', 'code', 'waggle-123')

    const finishChunk = emitTransportEventMock.mock.calls[0]
    expect(finishChunk[1].runId).toBe('waggle-123')
  })
})

describe('hydratePayloadAttachments', () => {
  it('delegates to hydrateAttachmentSources', async () => {
    const attachments = [makeAttachment()]
    const hydratedResult = [{ id: 'hydrated' }]
    hydrateAttachmentSourcesMock.mockResolvedValue(hydratedResult)

    const result = await hydratePayloadAttachments(attachments)

    expect(hydrateAttachmentSourcesMock).toHaveBeenCalledWith(attachments)
    expect(result).toBe(hydratedResult)
  })

  it('rejects more than the send-boundary attachment count before hydration', async () => {
    const attachments = Array.from({ length: ATTACHMENT.MAX_COUNT + 1 }, (_, index) =>
      makeAttachment({ id: `attachment-${String(index)}` }),
    )

    await expect(hydratePayloadAttachments(attachments)).rejects.toThrow(
      `A maximum of ${String(ATTACHMENT.MAX_COUNT)} attachments`,
    )
    expect(hydrateAttachmentSourcesMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate prepared attachment capability ids before hydration', async () => {
    const attachments = [
      makeAttachment({ id: 'duplicate', name: 'first.txt' }),
      makeAttachment({ id: 'duplicate', name: 'second.txt' }),
    ]

    await expect(hydratePayloadAttachments(attachments)).rejects.toThrow(
      'Duplicate prepared attachment capability',
    )
    expect(hydrateAttachmentSourcesMock).not.toHaveBeenCalled()
  })

  it('rejects an excessive aggregate attachment size before hydration', async () => {
    const attachments = Array.from({ length: 3 }, (_, index) =>
      makeAttachment({
        id: `attachment-${String(index)}`,
        sizeBytes: ATTACHMENT.MAX_SIZE_BYTES,
      }),
    )

    await expect(hydratePayloadAttachments(attachments)).rejects.toThrow(
      'Total attachment size exceeds',
    )
    expect(hydrateAttachmentSourcesMock).not.toHaveBeenCalled()
  })
})

describe('assignSessionTitleFromUserText', () => {
  it('writes the Provisional title and asks for a generated one on the first message', async () => {
    const title = await runTitleAssignment(makeSessionDetail(), '  Hello world  ', [
      makeAttachment({ id: 'shot', name: 'shot.png', mimeType: 'image/png' }),
    ])

    expect(title).toBe('Hello world')
    expect(assignProvisionalTitleMock).toHaveBeenCalledWith(CONV_ID, 'Hello world')
    expect(requestInitialSessionTitleMock).toHaveBeenCalledWith({
      sessionId: CONV_ID,
      text: 'Hello world',
      model: TITLE_MODEL,
      attachments: [{ id: 'shot', name: 'shot.png', mimeType: 'image/png' }],
    })
  })

  it('still asks for a generated title when the Session already has its Provisional title', async () => {
    assignProvisionalTitleMock.mockReturnValueOnce(false)
    const title = await runTitleAssignment(
      makeSessionDetail({ title: 'Review auth' }),
      'Review auth',
    )

    expect(title).toBeNull()
    expect(requestInitialSessionTitleMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing once the Session has messages', async () => {
    const title = await runTitleAssignment(
      makeSessionDetail({ messages: [makeMessage()] }),
      'Hello world',
    )

    expect(title).toBeNull()
    expect(assignProvisionalTitleMock).not.toHaveBeenCalled()
    expect(requestInitialSessionTitleMock).not.toHaveBeenCalled()
  })

  it('writes no Provisional title for blank text', async () => {
    const title = await runTitleAssignment(makeSessionDetail(), '   ')

    expect(title).toBeNull()
    expect(assignProvisionalTitleMock).not.toHaveBeenCalled()
  })
})
