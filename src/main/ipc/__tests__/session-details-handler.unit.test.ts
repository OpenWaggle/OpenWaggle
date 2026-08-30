import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { setProjectPreferences } from '../../config/project-config'
import {
  cleanupSessionRunMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  dispatchLocalSessionCommandMock,
  emitRunCompletedMock,
  getInvokeHandler,
  getSessionDetailMock,
  listSessionDetailsMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
  typedHandleMock,
} from './session-details-handler.test-harness'

describe('registerSessionDetailsHandlers', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('registers only session detail IPC channels', () => {
    registerSessionDetailsHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toEqual([
      'sessions:list-details',
      'sessions:get-detail',
      'sessions:turn-checkpoints:list',
      'sessions:turn-diff:get',
      'sessions:pins:list',
      'sessions:pins:pin',
      'sessions:pins:unpin',
      'sessions:pins:move',
      'sessions:create',
      'sessions:fork-to-new',
      'sessions:clone-to-new',
      'sessions:dismiss-interrupted-run',
      'sessions:delete',
      'sessions:archive',
      'sessions:unarchive',
      'sessions:list-archived',
      'sessions:update-title',
      'sessions:set-authorization-mode',
    ])
  })

  it('lists session details through the projection repository', async () => {
    const sessionDetails = [{ id: SessionId('session-1'), title: 'Session', messages: [] }]
    listSessionDetailsMock.mockResolvedValue(sessionDetails)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:list-details')

    const result = await handler?.({}, 10)
    expect(result).toEqual(sessionDetails)
    expect(listSessionDetailsMock).toHaveBeenCalledWith(10)
  })

  it('creates a session with the requested project path', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-test-'))
    const validatedProjectPath = await realpath(projectPath)
    try {
      const createdSession = {
        id: SessionId('session-created'),
        title: 'New session',
        messages: [],
      }
      getSessionDetailMock.mockResolvedValue(createdSession)

      registerSessionDetailsHandlers()
      const handler = getInvokeHandler('sessions:create')

      const result = await handler?.({}, projectPath)
      expect(result).toEqual(createdSession)
      expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith({
        caller: { callerId: 'gui:local-user', workingDirectory: validatedProjectPath },
        payload: {
          contract: 'session-lifecycle-v2',
          request: expect.objectContaining({
            contractVersion: 2,
            command: {
              operation: 'create',
              projectPath: validatedProjectPath,
              workspace: { mode: 'local' },
            },
          }),
        },
      })
      expect(getSessionDetailMock).toHaveBeenCalledWith(SessionId('session-created'))
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('stores no authorization override when creating a session, even with a project default', async () => {
    // Creation deliberately records nothing. The mode is a live chain resolved when a request is
    // raised, so snapshotting a project default here would freeze the session against later
    // changes to that default. A stored override must only ever come from an explicit user choice.
    const projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-test-'))
    const validatedProjectPath = await realpath(projectPath)
    try {
      const createdSession = {
        id: SessionId('session-created'),
        title: 'New session',
        messages: [],
      }
      await setProjectPreferences(validatedProjectPath, { authorizationMode: 'ask-for-approval' })
      getSessionDetailMock.mockResolvedValue(createdSession)

      registerSessionDetailsHandlers()
      const handler = getInvokeHandler('sessions:create')

      const result = await handler?.({}, projectPath)
      expect(result).toEqual(createdSession)
      expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            request: expect.objectContaining({
              command: expect.not.objectContaining({ runAuthorizationOverride: expect.anything() }),
            }),
          }),
        }),
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('forks a session from a user message through the Session Host', async () => {
    const sourceSession = {
      id: SessionId('session-source'),
      title: 'Source',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const forkedSession = {
      id: SessionId('pi-session-forked'),
      title: 'Forked',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 3,
      updatedAt: 4,
    }
    getSessionDetailMock.mockImplementation(async (id: SessionId) =>
      id === SessionId('pi-session-forked') ? forkedSession : sourceSession,
    )
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'session-lifecycle-v2',
        response: {
          contractVersion: 2,
          requestId: 'fork-request',
          idempotencyKey: 'fork-once',
          replayed: false,
          outcome: {
            operation: 'fork',
            effect: 'forked-session',
            sessionId: 'pi-session-forked',
            sourceSessionId: 'session-source',
            workspaceId: 'workspace-forked',
            editorText: 'retry text',
          },
        },
      }),
    )

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:fork-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('user-node'),
    )

    expect(result).toEqual({ cancelled: false, editorText: 'retry text', session: forkedSession })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({
              operation: 'fork',
              targetNodeId: 'user-node',
              position: 'before',
            }),
          }),
        }),
      }),
    )
  })

  it('clones a session from the current node through the Pi kernel', async () => {
    const sourceSession = {
      id: SessionId('session-source'),
      title: 'Source',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const clonedSession = {
      id: SessionId('pi-session-cloned'),
      title: 'Cloned',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 3,
      updatedAt: 4,
    }
    getSessionDetailMock.mockImplementation(async (id: SessionId) =>
      id === SessionId('pi-session-cloned') ? clonedSession : sourceSession,
    )
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'session-lifecycle-v2',
        response: {
          contractVersion: 2,
          requestId: 'clone-request',
          idempotencyKey: 'clone-once',
          replayed: false,
          outcome: {
            operation: 'fork',
            effect: 'forked-session',
            sessionId: 'pi-session-cloned',
            sourceSessionId: 'session-source',
            workspaceId: 'workspace-cloned',
          },
        },
      }),
    )

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:clone-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('current-node'),
    )

    expect(result).toEqual({ cancelled: false, session: clonedSession })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({
              operation: 'fork',
              targetNodeId: 'current-node',
              position: 'at',
            }),
          }),
        }),
      }),
    )
  })

  it('deletes through the Session Host before clearing GUI run state', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await handler?.({}, SessionId('session-delete'))

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: { operation: 'delete', sessionId: 'session-delete' },
          }),
        }),
      }),
    )
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(clearStreamBufferMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(emitRunCompletedMock).toHaveBeenCalledWith(SessionId('session-delete'))
  })

  it('archives a session through the Session Host', async () => {
    dispatchLocalSessionCommandMock.mockReturnValue(
      Effect.succeed({
        contract: 'session-control-v2',
        response: {
          contractVersion: 2,
          requestId: 'archive-request',
          idempotencyKey: 'archive-once',
          replayed: false,
          outcome: {
            operation: 'archive',
            effect: 'session-archived',
            sessionId: 'session-archive',
          },
        },
      }),
    )

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:archive')

    await handler?.({}, SessionId('session-archive'))

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: { operation: 'archive', sessionId: 'session-archive' },
          }),
        }),
      }),
    )
  })
})
