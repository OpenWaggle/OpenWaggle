import { registerAgentHandlers } from './agent-handler'
import { registerAttachmentHandlers } from './attachments-handler'
import { registerAuthHandlers } from './auth-handler'
import { registerComposerHandlers } from './composer-handler'
import { registerConversationsHandlers } from './conversations-handler'
import { registerDevtoolsHandlers } from './devtools-handler'
import { registerFeedbackHandlers } from './feedback-handler'
import { registerGitHandlers } from './git'
import { registerMcpHandlers } from './mcp-handler'
import { registerOrchestrationHandlers } from './orchestration-handler'
import { registerProjectHandlers } from './project-handler'
import { registerProvidersHandlers } from './providers-handler'
import { registerSettingsHandlers } from './settings-handler'
import { registerShellHandlers } from './shell-handler'
import { registerSkillsHandlers } from './skills-handler'
import { registerTeamsHandlers } from './teams-handler'
import { registerTerminalHandlers } from './terminal-handler'
import { registerUpdaterHandlers } from './updater-handler'
import { registerVoiceHandlers } from './voice-handler'
import { registerWaggleHandlers } from './waggle-handler'

export { cleanupTerminals } from './terminal-handler'

export function registerAllIpcHandlers(): void {
  registerAuthHandlers()
  registerAgentHandlers()
  registerSettingsHandlers()
  registerConversationsHandlers()
  registerAttachmentHandlers()
  registerDevtoolsHandlers()
  registerGitHandlers()
  registerProjectHandlers()
  registerProvidersHandlers()
  registerOrchestrationHandlers()
  registerTerminalHandlers()
  registerVoiceHandlers()
  registerSkillsHandlers()
  registerShellHandlers()
  registerWaggleHandlers()
  registerTeamsHandlers()
  registerMcpHandlers()
  registerFeedbackHandlers()
  registerUpdaterHandlers()
  registerComposerHandlers()
}
