import { SessionId, WorkingPath } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import type { IpcRendererEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn(() => '/mock/path') },
}))

import { ipcRenderer, webUtils } from 'electron'
import { api } from '../api'
import { PRELOAD_API_METHODS } from './preload-api-methods'

describe('preload api surface contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('matches the preload method contract exactly', () => {
    for (const method of PRELOAD_API_METHODS) expect(typeof api[method]).toBe('function')
    expect(Object.keys(api).sort()).toEqual([...PRELOAD_API_METHODS].sort())
  })

  it('reads only the requested session resource through typed IPC', async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      resourceId: 'resource-1',
      fileName: 'image.png',
      mimeType: 'image/png',
      url: 'openwaggle-session-resource://content/token/view',
      downloadUrl: 'openwaggle-session-resource://content/token/download',
    })

    await api.readSessionResource(SessionId('session-1'), 'resource-1')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'sessions:resources:read',
      SessionId('session-1'),
      'resource-1',
    )
  })

  it('reads Hive relations only for the requested Session through typed IPC', async () => {
    const sessionId = SessionId('session-1')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      current: null,
      parent: null,
      workers: [],
    })

    await api.getSessionHiveRelations(sessionId)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('sessions:get-hive-relations', sessionId)
  })

  it('updates the resource capability owner whenever the displayed Session changes', () => {
    api.activateSessionResourceOwner(SessionId('session-1'))
    api.activateSessionResourceOwner(null)

    expect(ipcRenderer.send).toHaveBeenNthCalledWith(
      1,
      'sessions:resources:activate-owner',
      SessionId('session-1'),
    )
    expect(ipcRenderer.send).toHaveBeenNthCalledWith(2, 'sessions:resources:activate-owner', null)
  })

  it('advances historical resource backfill without requesting the catalog', async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ backfillComplete: false })

    await api.advanceSessionResourceBackfill(SessionId('session-1'))

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'sessions:resources:backfill',
      SessionId('session-1'),
    )
  })

  it('preflights change-request readiness through typed IPC', async () => {
    const payload = {
      headRef: 'codex/session-summary',
      baseRef: 'main',
      title: 'Session summary',
      body: 'Ready for review.',
      draft: false,
    }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      provider: { id: 'github', host: 'github.com' },
      readiness: {
        ok: true,
        status: { authenticated: true, account: 'octocat', host: 'github.com' },
      },
      browserUrl: 'https://github.com/openwaggle/openwaggle/compare?expand=1',
      plannedHeadRef: 'codex/session-summary',
    })

    await api.preflightChangeRequest(WorkingPath('/tmp/repo'), payload)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'git:change-request:preflight',
      WorkingPath('/tmp/repo'),
      payload,
    )
  })

  it('keeps lifecycle reads and merges bound to the originating Session', async () => {
    const sessionId = SessionId('session-1')
    const workingPath = WorkingPath('/tmp/repo')
    const url = 'https://github.com/o/r/pull/7'
    const payload = { url, expectedHeadCommit: 'abc123', method: 'squash' as const }

    await api.getChangeRequestPanel(sessionId, workingPath, url)
    await api.mergeChangeRequest(sessionId, workingPath, payload)

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      'git:change-request:panel',
      sessionId,
      workingPath,
      url,
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      'git:change-request:merge',
      sessionId,
      workingPath,
      payload,
    )
  })

  it('validates branch names and cancels only the requested Git operation', async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(true)

    await api.validateGitBranchName(WorkingPath('/tmp/repo'), 'feature/session-summary')
    await api.cancelStackedGitAction('git-operation-1')

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      'git:branches:validate-name',
      WorkingPath('/tmp/repo'),
      'feature/session-summary',
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      'git:stacked-action:cancel',
      'git-operation-1',
    )
  })

  it('requests a bounded session resource thumbnail through its own IPC channel', async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      resourceId: 'resource-1',
      fileName: 'resource-1-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: 'dGh1bWJuYWls',
    })

    await api.readSessionResourceThumbnail(SessionId('session-1'), 'resource-1')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'sessions:resources:thumbnail',
      SessionId('session-1'),
      'resource-1',
    )
  })

  it('retries only the requested resource through typed IPC', async () => {
    await api.retrySessionResource(SessionId('session-1'), 'resource-1')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'sessions:resources:retry',
      SessionId('session-1'),
      'resource-1',
    )
  })

  it('subscribes to resource invalidation for the affected session and cleans up', () => {
    const listener = vi.fn()
    const unsubscribe = api.onSessionResourcesInvalidated(listener)
    const registered = vi
      .mocked(ipcRenderer.on)
      .mock.calls.find(([channel]) => channel === 'sessions:resources-invalidated')

    expect(registered).toBeDefined()
    registered?.[1](fromPartial<IpcRendererEvent>({}), {
      sessionId: SessionId('session-background'),
    })
    expect(listener).toHaveBeenCalledWith({ sessionId: SessionId('session-background') })

    unsubscribe()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'sessions:resources-invalidated',
      registered?.[1],
    )
  })

  it('prepares attachments from user-selected File objects via preload path extraction', async () => {
    const file = new File(['screenshot'], 'screenshot.png')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([])
    vi.mocked(webUtils.getPathForFile).mockReturnValueOnce('/tmp/Desktop/screenshot.png')

    await api.prepareAttachments('/tmp/repo', [file])

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(file)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('attachments:prepare', '/tmp/repo', [
      '/tmp/Desktop/screenshot.png',
    ])
  })

  it('discards only the exact prepared attachment through typed IPC', async () => {
    const attachment = {
      id: 'prepared-resource-image',
      kind: 'image' as const,
      origin: 'user-file' as const,
      name: 'diagram.png',
      path: '/tmp/private/diagram.png',
      mimeType: 'image/png',
      sizeBytes: 12,
      extractedText: '',
    }

    await api.discardPreparedAttachment(attachment)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('attachments:discard', attachment)
  })

  it('reveals the requested local path through typed IPC', async () => {
    await api.revealPath('/tmp/image.png')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('shell:reveal-path', '/tmp/image.png')
  })

  describe('event listener methods return unsubscribe functions', () => {
    beforeEach(() => {
      vi.mocked(ipcRenderer.on).mockReturnValue(ipcRenderer)
      vi.mocked(ipcRenderer.removeListener).mockReturnValue(ipcRenderer)
    })

    const EVENT_METHODS = [
      'onAgentEvent',
      'onAgentPhase',
      'onRunCompleted',
      'onPrepareAttachmentFromTextProgress',
      'onTerminalData',
      'onFullscreenChanged',
      'onWaggleEvent',
      'onWaggleTurnEvent',
      'onOAuthStatus',
      'onSessionTitleUpdated',
      'onSessionListInvalidated',
      'onSessionResourcesInvalidated',
      'onGitStackedActionProgress',
      'onUpdateStatus',
    ] as const

    for (const method of EVENT_METHODS) {
      it(`${method} returns an unsubscribe function`, () => {
        const unsubscribe = api[method](() => {})
        expect(typeof unsubscribe).toBe('function')
      })
    }
  })
})
