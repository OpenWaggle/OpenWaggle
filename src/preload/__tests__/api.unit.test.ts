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

  it('preserves original File indexes when preload filters and deduplicates paths', async () => {
    const pathless = new File(['clipboard'], 'clipboard.png')
    const file = new File(['screenshot'], 'screenshot.png')
    const duplicate = new File(['screenshot'], 'copy.png')
    const attachment = {
      id: 'prepared-image',
      kind: 'image' as const,
      origin: 'user-file' as const,
      name: 'screenshot.png',
      path: '/tmp/Desktop/screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      extractedText: '',
    }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([attachment])
    vi.mocked(webUtils.getPathForFile)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('/tmp/Desktop/screenshot.png')
      .mockReturnValueOnce('/tmp/Desktop/screenshot.png')

    await expect(api.prepareAttachments('/tmp/repo', [pathless, file, duplicate])).resolves.toEqual(
      [{ attachment, fileIndex: 1 }],
    )

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

  it('sends native project action requests through typed IPC', async () => {
    const request = { scope: { projectPath: '/tmp/repo' }, operation: { type: 'catalog' as const } }
    await api.manageProjectActions(request)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('project-actions:manage', request)
  })

  it('loads the initial global terminal activity snapshot through typed IPC', async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      revision: 3,
      summaries: [],
      truncated: false,
    })

    await api.getTerminalActivitySnapshot()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('terminal:get-activity-snapshot')
  })

  it('registers the configured shortcut chords claimed from native browser previews', async () => {
    const bindings = [{ key: 'K', mod: true }]

    await api.setBrowserPreviewShortcutBindings(bindings)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'browser-preview:set-shortcut-bindings',
      bindings,
    )
  })

  it('imports browser cookies through typed IPC', async () => {
    const input = {
      sourceId: 'chrome' as const,
      sourceProfileDirectory: 'Default',
      targetProfileId: 'default',
    }

    await api.importBrowserCookies(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('browser-preview:import-cookies', input)
  })

  it('runs the guided browser cookie import through typed IPC', async () => {
    const input = {
      sourceId: 'safari' as const,
      sourceProfileDirectory: 'Default',
      target: { kind: 'new' as const, profileId: 'profile-stable' },
    }

    await api.guidedImportBrowserCookies(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('browser-preview:guided-import-cookies', input)
  })

  it('opens the fixed Full Disk Access settings destination through typed IPC', async () => {
    await api.openBrowserImportFullDiskAccessSettings()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'browser-preview:open-full-disk-access-settings',
    )
  })

  it('acknowledges a trusted browser-preview materialization through typed IPC', async () => {
    const acknowledgment = {
      requestId: 'request-1',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'preview-1',
      success: true,
    } as const

    await api.acknowledgeBrowserPreviewOpenRequest(acknowledgment)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'browser-preview:ack-open-request',
      acknowledgment,
    )
  })

  describe('event listener methods return unsubscribe functions', () => {
    beforeEach(() => {
      vi.mocked(ipcRenderer.on).mockReturnValue(ipcRenderer)
      vi.mocked(ipcRenderer.removeListener).mockReturnValue(ipcRenderer)
    })

    const EVENT_METHODS = [
      'onAgentEvent',
      'onAgentPhase',
      'onSessionHostEvent',
      'onSessionHostResyncRequired',
      'onRunCompleted',
      'onPrepareAttachmentFromTextProgress',
      'onTerminalEvent',
      'onTerminalActivitySnapshot',
      'onBrowserPreviewState',
      'onBrowserPreviewShortcut',
      'onBrowserPreviewKeyEvent',
      'onBrowserPreviewOpenRequest',
      'onBrowserPreviewOpenRequestCancellation',
      'onBrowserPreviewRecordingRequest',
      'onBrowserPreviewRecordingCancel',
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
