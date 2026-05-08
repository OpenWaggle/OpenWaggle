import { registerAgentHandlers } from './agent-handler'
import { registerAttachmentHandlers } from './attachments-handler'
import { registerAuthHandlers } from './auth-handler'
import { registerComposerHandlers } from './composer-handler'
import { registerFeedbackHandlers } from './feedback-handler'
import { registerGitHandlers } from './git'
import { registerProjectHandlers } from './project-handler'
import { registerProvidersHandlers } from './providers-handler'
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

export { cleanupTerminals } from './terminal-handler'

export function registerAllIpcHandlers(): void {
  registerAuthHandlers()
  registerAgentHandlers()
  registerSettingsHandlers()
  registerSessionsHandlers()
  registerSessionDetailsHandlers()
  registerAttachmentHandlers()
  registerGitHandlers()
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
}
