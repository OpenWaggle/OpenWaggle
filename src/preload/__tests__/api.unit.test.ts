import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
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

  it('lists extension contributions through the typed IPC channel', async () => {
    const input = { projectPaths: ['/tmp/project'] }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      projectPaths: ['/tmp/project'],
      entries: [],
    })

    await api.listExtensionContributions(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extensions:list-contributions', input)
  })

  it('proposes extension package writes through the typed IPC channel', async () => {
    const input = {
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      mode: 'create',
      files: [{ relativePath: 'openwaggle.extension.json', content: '{}' }],
      actor: { kind: 'agent', agentId: 'agent-1' },
    } as const
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      mode: 'create',
      operation: 'write:create',
      actor: { kind: 'agent', agentId: 'agent-1' },
      proposalHash: 'a'.repeat(64),
      files: [],
      fileCount: 0,
      totalBytes: 0,
      requiresGlobalConfirmation: false,
      globalConfirmationRisk: null,
    })

    await api.proposeExtensionPackageWrite(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extensions:propose-package-write', input)
  })

  it('applies approved extension package writes through the typed IPC channel', async () => {
    const proposalHash = 'a'.repeat(64)
    const input = {
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      mode: 'create',
      files: [{ relativePath: 'openwaggle.extension.json', content: '{}' }],
      actor: { kind: 'agent', agentId: 'agent-1' },
      userApproval: {
        approved: true,
        approvedProposalHash: proposalHash,
        approvedBy: 'User',
        approvedAt: 1000,
      },
    } as const
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      projectPath: '/tmp/project',
      projectPaths: ['/tmp/project'],
      packages: [],
    })

    await api.applyExtensionPackageWrite(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extensions:apply-package-write', input)
  })

  it('invokes extension capabilities through the generic broker IPC channel', async () => {
    const input = {
      extensionId: 'sample-extension',
      contributionId: 'sample.run',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      payload: {},
    } as const
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION },
    })

    await api.invokeExtension(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extensions:invoke', input)
  })

  it('discovers docs through the typed IPC channel', async () => {
    const input = { projectPaths: ['/tmp/project'], includeExtensions: true }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
      generatedAt: '2026-01-01T00:00:00.000Z',
      bundlePath: '/tmp/openwaggle-docs',
      firstPartyTopics: [],
      extensionTopics: [],
      diagnostics: [],
    })

    await api.discoverDocs(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('docs:discover', input)
  })

  it('resolves first-party docs through the typed IPC channel', async () => {
    const input = { topic: 'openwaggle:extending/openwaggle-extensions' } as const
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(null)

    await api.resolveDocsTopic(input)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('docs:resolve-topic', input)
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
      'onTerminalEvent',
      'onFullscreenChanged',
      'onWaggleEvent',
      'onWaggleTurnEvent',
      'onOAuthStatus',
      'onSessionTitleUpdated',
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
