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
import { api } from './api'

describe('preload api surface contract', () => {
  // ─── Agent ──────────────────────────────────────────────
  describe('agent methods', () => {
    it('exposes sendMessage', () => {
      expect(typeof api.sendMessage).toBe('function')
    })

    it('exposes cancelAgent', () => {
      expect(typeof api.cancelAgent).toBe('function')
    })

    it('exposes onStreamChunk', () => {
      expect(typeof api.onStreamChunk).toBe('function')
    })
  })

  // ─── Agent Questions ────────────────────────────────────
  describe('agent question methods', () => {
    it('exposes answerQuestion', () => {
      expect(typeof api.answerQuestion).toBe('function')
    })

    it('exposes getAgentPhase', () => {
      expect(typeof api.getAgentPhase).toBe('function')
    })

    it('exposes onQuestion', () => {
      expect(typeof api.onQuestion).toBe('function')
    })

    it('exposes onAgentPhase', () => {
      expect(typeof api.onAgentPhase).toBe('function')
    })
  })

  // ─── Settings ───────────────────────────────────────────
  describe('settings methods', () => {
    it('exposes getSettings', () => {
      expect(typeof api.getSettings).toBe('function')
    })

    it('exposes updateSettings', () => {
      expect(typeof api.updateSettings).toBe('function')
    })

    it('exposes testApiKey', () => {
      expect(typeof api.testApiKey).toBe('function')
    })
  })

  // ─── Providers ──────────────────────────────────────────
  describe('provider methods', () => {
    it('exposes getProviderModels', () => {
      expect(typeof api.getProviderModels).toBe('function')
    })

    it('exposes fetchProviderModels', () => {
      expect(typeof api.fetchProviderModels).toBe('function')
    })
  })

  // ─── Project ────────────────────────────────────────────
  describe('project methods', () => {
    it('exposes selectProjectFolder', () => {
      expect(typeof api.selectProjectFolder).toBe('function')
    })
  })

  // ─── Conversations ─────────────────────────────────────
  describe('conversation methods', () => {
    it('exposes listConversations', () => {
      expect(typeof api.listConversations).toBe('function')
    })

    it('exposes getConversation', () => {
      expect(typeof api.getConversation).toBe('function')
    })

    it('exposes createConversation', () => {
      expect(typeof api.createConversation).toBe('function')
    })

    it('exposes deleteConversation', () => {
      expect(typeof api.deleteConversation).toBe('function')
    })

    it('exposes updateConversationTitle', () => {
      expect(typeof api.updateConversationTitle).toBe('function')
    })

    it('exposes updateConversationProjectPath', () => {
      expect(typeof api.updateConversationProjectPath).toBe('function')
    })
  })

  // ─── Devtools ───────────────────────────────────────────
  describe('devtools methods', () => {
    it('exposes getDevtoolsEventBusConfig', () => {
      expect(typeof api.getDevtoolsEventBusConfig).toBe('function')
    })
  })

  // ─── Terminal ───────────────────────────────────────────
  describe('terminal methods', () => {
    it('exposes createTerminal', () => {
      expect(typeof api.createTerminal).toBe('function')
    })

    it('exposes closeTerminal', () => {
      expect(typeof api.closeTerminal).toBe('function')
    })

    it('exposes resizeTerminal', () => {
      expect(typeof api.resizeTerminal).toBe('function')
    })

    it('exposes writeTerminal', () => {
      expect(typeof api.writeTerminal).toBe('function')
    })

    it('exposes onTerminalData', () => {
      expect(typeof api.onTerminalData).toBe('function')
    })
  })

  // ─── Window ─────────────────────────────────────────────
  describe('window methods', () => {
    it('exposes onFullscreenChanged', () => {
      expect(typeof api.onFullscreenChanged).toBe('function')
    })
  })

  // ─── Git ────────────────────────────────────────────────
  describe('git methods', () => {
    it('exposes getGitStatus', () => {
      expect(typeof api.getGitStatus).toBe('function')
    })

    it('exposes commitGit', () => {
      expect(typeof api.commitGit).toBe('function')
    })

    it('exposes getGitDiff', () => {
      expect(typeof api.getGitDiff).toBe('function')
    })

    it('exposes listGitBranches', () => {
      expect(typeof api.listGitBranches).toBe('function')
    })

    it('exposes checkoutGitBranch', () => {
      expect(typeof api.checkoutGitBranch).toBe('function')
    })

    it('exposes createGitBranch', () => {
      expect(typeof api.createGitBranch).toBe('function')
    })

    it('exposes renameGitBranch', () => {
      expect(typeof api.renameGitBranch).toBe('function')
    })

    it('exposes deleteGitBranch', () => {
      expect(typeof api.deleteGitBranch).toBe('function')
    })

    it('exposes setGitBranchUpstream', () => {
      expect(typeof api.setGitBranchUpstream).toBe('function')
    })
  })

  // ─── Attachments ────────────────────────────────────────
  describe('attachment methods', () => {
    it('exposes prepareAttachments', () => {
      expect(typeof api.prepareAttachments).toBe('function')
    })
  })

  // ─── Voice ──────────────────────────────────────────────
  describe('voice methods', () => {
    it('exposes transcribeVoiceLocal', () => {
      expect(typeof api.transcribeVoiceLocal).toBe('function')
    })
  })

  // ─── Standards & Skills ─────────────────────────────────
  describe('standards and skills methods', () => {
    it('exposes getStandardsStatus', () => {
      expect(typeof api.getStandardsStatus).toBe('function')
    })

    it('exposes getEffectiveAgents', () => {
      expect(typeof api.getEffectiveAgents).toBe('function')
    })

    it('exposes listSkills', () => {
      expect(typeof api.listSkills).toBe('function')
    })

    it('exposes setSkillEnabled', () => {
      expect(typeof api.setSkillEnabled).toBe('function')
    })

    it('exposes getSkillPreview', () => {
      expect(typeof api.getSkillPreview).toBe('function')
    })
  })

  // ─── Shell / App ────────────────────────────────────────
  describe('shell and app methods', () => {
    it('exposes openLogsDir', () => {
      expect(typeof api.openLogsDir).toBe('function')
    })

    it('exposes getLogsPath', () => {
      expect(typeof api.getLogsPath).toBe('function')
    })
  })

  // ─── Dialog ─────────────────────────────────────────────
  describe('dialog methods', () => {
    it('exposes showConfirm', () => {
      expect(typeof api.showConfirm).toBe('function')
    })
  })

  // ─── Orchestration ──────────────────────────────────────
  describe('orchestration methods', () => {
    it('exposes getOrchestrationRun', () => {
      expect(typeof api.getOrchestrationRun).toBe('function')
    })

    it('exposes listOrchestrationRuns', () => {
      expect(typeof api.listOrchestrationRuns).toBe('function')
    })

    it('exposes cancelOrchestrationRun', () => {
      expect(typeof api.cancelOrchestrationRun).toBe('function')
    })

    it('exposes onOrchestrationEvent', () => {
      expect(typeof api.onOrchestrationEvent).toBe('function')
    })
  })

  // ─── Waggle Mode ────────────────────────────────────────
  describe('waggle mode methods', () => {
    it('exposes sendWaggleMessage', () => {
      expect(typeof api.sendWaggleMessage).toBe('function')
    })

    it('exposes cancelWaggle', () => {
      expect(typeof api.cancelWaggle).toBe('function')
    })

    it('exposes onWaggleStreamChunk', () => {
      expect(typeof api.onWaggleStreamChunk).toBe('function')
    })

    it('exposes onWaggleTurnEvent', () => {
      expect(typeof api.onWaggleTurnEvent).toBe('function')
    })
  })

  // ─── Auth ───────────────────────────────────────────────
  describe('auth methods', () => {
    it('exposes startOAuth', () => {
      expect(typeof api.startOAuth).toBe('function')
    })

    it('exposes submitAuthCode', () => {
      expect(typeof api.submitAuthCode).toBe('function')
    })

    it('exposes disconnectAuth', () => {
      expect(typeof api.disconnectAuth).toBe('function')
    })

    it('exposes getAuthAccountInfo', () => {
      expect(typeof api.getAuthAccountInfo).toBe('function')
    })

    it('exposes onOAuthStatus', () => {
      expect(typeof api.onOAuthStatus).toBe('function')
    })
  })

  // ─── Teams ──────────────────────────────────────────────
  describe('teams methods', () => {
    it('exposes listTeams', () => {
      expect(typeof api.listTeams).toBe('function')
    })

    it('exposes saveTeam', () => {
      expect(typeof api.saveTeam).toBe('function')
    })

    it('exposes deleteTeam', () => {
      expect(typeof api.deleteTeam).toBe('function')
    })
  })

  // ─── Aggregate shape check ──────────────────────────────
  describe('aggregate contract', () => {
    const EXPECTED_METHODS = [
      // Agent
      'sendMessage',
      'cancelAgent',
      'onStreamChunk',
      // Agent Questions
      'answerQuestion',
      'getAgentPhase',
      'onQuestion',
      'onAgentPhase',
      // Settings
      'getSettings',
      'updateSettings',
      'testApiKey',
      // Providers
      'getProviderModels',
      'fetchProviderModels',
      // Project
      'selectProjectFolder',
      // Conversations
      'listConversations',
      'getConversation',
      'createConversation',
      'deleteConversation',
      'updateConversationTitle',
      'updateConversationProjectPath',
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
      // Voice
      'transcribeVoiceLocal',
      // Standards & Skills
      'getStandardsStatus',
      'getEffectiveAgents',
      'listSkills',
      'setSkillEnabled',
      'getSkillPreview',
      // Shell / App
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
  })

  // ─── Event listener unsubscribe pattern ─────────────────
  describe('event listener methods return unsubscribe functions', () => {
    beforeEach(() => {
      vi.mocked(ipcRenderer.on).mockReturnValue(ipcRenderer)
      vi.mocked(ipcRenderer.removeListener).mockReturnValue(ipcRenderer)
    })

    const EVENT_METHODS = [
      'onStreamChunk',
      'onQuestion',
      'onAgentPhase',
      'onTerminalData',
      'onFullscreenChanged',
      'onOrchestrationEvent',
      'onWaggleStreamChunk',
      'onWaggleTurnEvent',
      'onOAuthStatus',
    ] as const

    for (const method of EVENT_METHODS) {
      it(`${method} returns an unsubscribe function`, () => {
        const unsubscribe = api[method](() => {})
        expect(typeof unsubscribe).toBe('function')
      })
    }
  })
})
