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

import { ipcRenderer } from 'electron'
import { api } from '../api'

describe('preload api surface contract', () => {
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
    'testApiKey',
    'setProviderApiKey',
    // Providers
    'getProviderModels',
    // Project
    'selectProjectFolder',
    'getProjectPreferences',
    'setProjectPreferences',
    // Conversations
    'listConversations',
    'listFullConversations',
    'getConversation',
    'createConversation',
    'deleteConversation',
    'archiveConversation',
    'unarchiveConversation',
    'listArchivedConversations',
    'updateConversationTitle',
    'listSessions',
    'getSessionTree',
    'getSessionWorkspace',
    'navigateSessionTree',
    'onConversationTitleUpdated',
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
    // File paths
    'getFilePath',
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
    // Teams
    'listTeams',
    'saveTeam',
    'deleteTeam',
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
      'onConversationTitleUpdated',
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
