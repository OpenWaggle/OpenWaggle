import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  archiveSessionMock,
  cancelSessionRunsMock,
  cleanupSessionRunMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  createRuntimeSessionMock,
  createSessionMock,
  deleteSessionMock,
  emitRunCompletedMock,
  forkRuntimeSessionMock,
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
      'sessions:create',
      'sessions:fork-to-new',
      'sessions:clone-to-new',
      'sessions:dismiss-interrupted-run',
      'sessions:delete',
      'sessions:archive',
      'sessions:unarchive',
      'sessions:list-archived',
      'sessions:update-title',
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
      createSessionMock.mockResolvedValue(createdSession)

      registerSessionDetailsHandlers()
      const handler = getInvokeHandler('sessions:create')

      const result = await handler?.({}, projectPath)
      expect(result).toEqual(createdSession)
      expect(createRuntimeSessionMock).toHaveBeenCalledWith({ projectPath: validatedProjectPath })
      expect(createSessionMock).toHaveBeenCalledWith({
        projectPath: validatedProjectPath,
        piSessionId: 'pi-session-created',
        piSessionFile: '/tmp/pi-session-created.jsonl',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('forks a session from a user message through the Pi kernel and projection repository', async () => {
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
    createSessionMock.mockResolvedValue(forkedSession)
    forkRuntimeSessionMock.mockResolvedValue({
      cancelled: false,
      editorText: 'retry text',
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
      sessionSnapshot: { activeNodeId: 'parent-node', nodes: [] },
    })

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:fork-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('user-node'),
    )

    expect(result).toEqual({ cancelled: false, editorText: 'retry text', session: forkedSession })
    expect(forkRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetNodeId: 'user-node', position: 'before' }),
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
    createSessionMock.mockResolvedValue(clonedSession)
    forkRuntimeSessionMock.mockResolvedValue({
      cancelled: false,
      piSessionId: 'pi-session-cloned',
      piSessionFile: '/tmp/pi-session-cloned.jsonl',
      sessionSnapshot: { activeNodeId: 'current-node', nodes: [] },
    })

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:clone-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('current-node'),
    )

    expect(result).toEqual({ cancelled: false, session: clonedSession })
    expect(forkRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetNodeId: 'current-node', position: 'at' }),
    )
  })

  it('cleans up the active run before deleting a session', async () => {
    deleteSessionMock.mockResolvedValue(undefined)
    cancelSessionRunsMock.mockReturnValue(true)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await handler?.({}, SessionId('session-delete'))

    expect(cancelSessionRunsMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(clearStreamBufferMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(emitRunCompletedMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(deleteSessionMock).toHaveBeenCalledWith(SessionId('session-delete'))
  })

  it('cleans up the active run before archiving a session', async () => {
    archiveSessionMock.mockResolvedValue(undefined)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:archive')

    await handler?.({}, SessionId('session-archive'))

    expect(cancelSessionRunsMock).toHaveBeenCalledWith(SessionId('session-archive'))
    expect(clearAgentPhaseMock).toHaveBeenCalledWith(SessionId('session-archive'))
    expect(clearStreamBufferMock).toHaveBeenCalledWith(SessionId('session-archive'))
    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-archive'))
    expect(emitRunCompletedMock).not.toHaveBeenCalled()
    expect(archiveSessionMock).toHaveBeenCalledWith(SessionId('session-archive'))
  })
})
