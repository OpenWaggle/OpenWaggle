import { registerAgentDefinitionsHandlers } from './agent-definitions-handler'
import { registerAgentHandlers } from './agent-handler'
import { registerAttachmentHandlers } from './attachments-handler'
import { registerAuthHandlers } from './auth-handler'
import { registerComposerHandlers } from './composer-handler'
import { registerDocsHandlers } from './docs-handler'
import { registerExtensionBrokerHandlers } from './extension-broker-handler'
import { registerExtensionFrameHandlers } from './extension-frame-handler'
import { registerExtensionsHandlers } from './extensions-handler'
import { registerFeedbackHandlers } from './feedback-handler'
import { registerGitHandlers } from './git'
import { registerMcpHandlers } from './mcp-handler'
import { registerProfileAccessHandlers } from './profile-access-handler'
import { registerProjectHandlers } from './project-handler'
import { registerProvidersHandlers } from './providers-handler'
import { registerSessionControlHandlers } from './session-control-handler'
import { registerSessionDetailsHandlers } from './session-details-handler'
import { registerSessionsHandlers } from './sessions-handler'
import { registerSettingsHandlers } from './settings-handler'
import { registerShellHandlers } from './shell-handler'
import { registerSkillsHandlers } from './skills-handler'
import { registerTerminalHandlers } from './terminal-handler'
import { registerUpdaterHandlers } from './updater-handler'
import { registerVoiceHandlers } from './voice-handler'
import { registerWaggleHandlers } from './waggle-handler'
import { registerWagglePresetsHandlers } from './waggle-presets-handler'
import { registerWorkspaceFileHandlers } from './workspace-files-handler'

export { cleanupTerminals } from './terminal-handler'

export function registerAllIpcHandlers(): void {
  registerProfileAccessHandlers()
  registerAgentDefinitionsHandlers()
  registerAuthHandlers()
  registerAgentHandlers()
  registerSessionControlHandlers()
  registerSettingsHandlers()
  registerSessionsHandlers()
  registerSessionDetailsHandlers()
  registerAttachmentHandlers()
  registerGitHandlers()
  registerExtensionsHandlers()
  registerExtensionBrokerHandlers()
  registerExtensionFrameHandlers()
  registerMcpHandlers()
  registerProjectHandlers()
  registerProvidersHandlers()
  registerTerminalHandlers()
  registerVoiceHandlers()
  registerSkillsHandlers()
  registerShellHandlers()
  registerWaggleHandlers()
  registerWagglePresetsHandlers()
  registerFeedbackHandlers()
  registerUpdaterHandlers()
  registerComposerHandlers()
  registerDocsHandlers()
  registerWorkspaceFileHandlers()
}
