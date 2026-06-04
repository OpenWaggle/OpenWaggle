import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: {
    getPathForFile: vi.fn(() => '/mock/path'),
  },
}))

import { ipcRenderer, webUtils } from 'electron'
import { api } from '../api'
import { createExtensionBrokerSdk, type ExtensionBrokerTransport } from '../extension-sdk'

describe('preload api surface contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const EXPECTED_METHODS = [
    // Agent
    'sendMessage',
    'cancelAgent',
    'steerAgent',
    'onAgentEvent',
    'getAgentPhase',
    'getBackgroundRun',
    'listActiveRuns',
    'getContextUsage',
    'compactSession',
    'onRunCompleted',
    'onAgentPhase',
    // Settings
    'getSettings',
    'updateSettings',
    'setEnabledModels',
    'getPiTreeFilterMode',
    'setPiTreeFilterMode',
    'getPiBranchSummarySkipPrompt',
    'testApiKey',
    'getMcpSettings',
    'setMcpAdapterEnabled',
    'setMcpServerEnabled',
    'writeMcpSourceConfig',
    'listExtensionPackages',
    'listExtensionContributions',
    'invokeExtension',
    'setExtensionTrusted',
    'setExtensionEnabled',
    'setExtensionProjectDisabled',
    'acceptExtensionUpdate',
    'approveExtensionBuild',
    'reloadExtension',
    'setProviderApiKey',
    // Providers
    'getProviderModels',
    // Project
    'selectProjectFolder',
    'getProjectPreferences',
    'setProjectPreferences',
    'listSessions',
    'listSessionDetails',
    'getSessionDetail',
    'createSession',
    'forkSessionToNew',
    'cloneSessionToNew',
    'dismissInterruptedSessionRun',
    'deleteSession',
    'archiveSession',
    'unarchiveSession',
    'listArchivedSessions',
    'updateSessionTitle',
    'listArchivedSessionBranches',
    'getSessionTree',
    'getSessionWorkspace',
    'navigateSessionTree',
    'renameSessionBranch',
    'archiveSessionBranch',
    'restoreSessionBranch',
    'updateSessionTreeUiState',
    'onSessionTitleUpdated',
    // Terminal
    'createTerminal',
    'closeTerminal',
    'resizeTerminal',
    'writeTerminal',
    'onTerminalData',
    // Window
    'onFullscreenChanged',
    // Git
    'getGitStatus',
    'commitGit',
    'getGitDiff',
    'listGitBranches',
    'checkoutGitBranch',
    'createGitBranch',
    'renameGitBranch',
    'deleteGitBranch',
    'setGitBranchUpstream',
    // Attachments
    'prepareAttachments',
    'prepareAttachmentFromText',
    'onPrepareAttachmentFromTextProgress',
    // Voice
    'transcribeVoiceLocal',
    // Standards & Skills
    'getStandardsStatus',
    'getEffectiveAgents',
    'listSkills',
    'setSkillEnabled',
    'getSkillPreview',
    // Shell / App
    'copyToClipboard',
    'openLogsDir',
    'getLogsPath',
    'openPath',
    // Dialog
    'showConfirm',
    // Waggle
    'sendWaggleMessage',
    'cancelWaggle',
    'onWaggleEvent',
    'onWaggleTurnEvent',
    // Auth
    'startOAuth',
    'submitAuthCode',
    'cancelOAuth',
    'disconnectAuth',
    'getAuthAccountInfo',
    'onOAuthStatus',
    // Waggle presets
    'listWagglePresets',
    'saveWagglePreset',
    'deleteWagglePreset',
    // Feedback
    'checkGhCli',
    'collectDiagnostics',
    'getRecentLogs',
    'submitFeedback',
    'generateFeedbackMarkdown',
    'openExternal',
    // Composer
    'suggestFiles',
    // Auto-updater
    'checkForUpdates',
    'installUpdate',
    'getUpdateStatus',
    'getAppVersion',
    'onUpdateStatus',
  ] as const

  it('has every expected method as a function', () => {
    for (const method of EXPECTED_METHODS) {
      expect(api).toHaveProperty(method)
      expect(typeof api[method]).toBe('function')
    }
  })

  it('has no unexpected methods beyond the contract', () => {
    const actualKeys = Object.keys(api).sort()
    const expectedKeys = [...EXPECTED_METHODS].sort()
    expect(actualKeys).toEqual(expectedKeys)
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

  it('builds typed extension SDK broker calls from extension identity', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async () => ({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION,
        message: 'Unknown extension.',
      },
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.run',
    })

    await sdk.hostContext.getScope({ kind: 'project', projectPath: '/tmp/project' })

    expect(transport).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      contributionId: 'sample.run',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      payload: {},
    })
  })

  it('builds typed extension SDK storage calls through the generic broker', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async () => ({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION,
        message: 'Unknown extension.',
      },
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.storage',
    })

    await sdk.storage.config.set(
      { kind: 'project', projectPath: '/tmp/project' },
      'settings',
      { enabled: true },
      { storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND },
    )

    expect(transport).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      contributionId: 'sample.storage',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      payload: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        key: 'settings',
        value: { enabled: true },
      },
    })
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
