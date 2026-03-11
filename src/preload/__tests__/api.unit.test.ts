import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
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
    'onStreamChunk',
    // Context Injection
    'injectContext',
    'onContextInjected',
    // Agent Questions
    'answerQuestion',
    'getAgentPhase',
    'getBackgroundRun',
    'listActiveRuns',
    'onRunCompleted',
    'onQuestion',
    'onAgentPhase',
    // Agent Plan
    'respondToPlan',
    'onPlanProposal',
    // Settings
    'getSettings',
    'updateSettings',
    'testApiKey',
    // Providers
    'getProviderModels',
    'fetchProviderModels',
    // Project
    'selectProjectFolder',
    'isProjectToolCallTrusted',
    'recordProjectToolApproval',
    'getProjectPreferences',
    'setProjectPreferences',
    // Conversations
    'listConversations',
    'getConversation',
    'createConversation',
    'deleteConversation',
    'archiveConversation',
    'unarchiveConversation',
    'listArchivedConversations',
    'updateConversationTitle',
    'updateConversationProjectPath',
    'onConversationTitleUpdated',
    // Devtools
    'getDevtoolsEventBusConfig',
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
    // Dialog
    'showConfirm',
    // Orchestration
    'getOrchestrationRun',
    'listOrchestrationRuns',
    'cancelOrchestrationRun',
    'onOrchestrationEvent',
    // Waggle
    'sendWaggleMessage',
    'cancelWaggle',
    'onWaggleStreamChunk',
    'onWaggleTurnEvent',
    // Auth
    'startOAuth',
    'submitAuthCode',
    'disconnectAuth',
    'getAuthAccountInfo',
    'onOAuthStatus',
    // Teams
    'listTeams',
    'saveTeam',
    'deleteTeam',
    // MCP
    'listMcpServers',
    'addMcpServer',
    'removeMcpServer',
    'toggleMcpServer',
    'updateMcpServer',
    'onMcpStatusChanged',
    // Sub-Agents
    'onSubAgentEvent',
    'onTeamEvent',
    // Feedback
    'checkGhCli',
    'collectDiagnostics',
    'getRecentLogs',
    'submitFeedback',
    'generateFeedbackMarkdown',
    'openExternal',
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
      'onStreamChunk',
      'onContextInjected',
      'onQuestion',
      'onAgentPhase',
      'onRunCompleted',
      'onPlanProposal',
      'onPrepareAttachmentFromTextProgress',
      'onTerminalData',
      'onFullscreenChanged',
      'onOrchestrationEvent',
      'onWaggleStreamChunk',
      'onWaggleTurnEvent',
      'onOAuthStatus',
      'onMcpStatusChanged',
      'onSubAgentEvent',
      'onTeamEvent',
      'onConversationTitleUpdated',
    ] as const

    for (const method of EVENT_METHODS) {
      it(`${method} returns an unsubscribe function`, () => {
        const unsubscribe = api[method](() => {})
        expect(typeof unsubscribe).toBe('function')
      })
    }
  })
})
