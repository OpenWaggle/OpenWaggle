import { parseCompactCommand } from './compact-command'
import { parseSessionCopyCommand } from './session-copy-command'

export const GUI_COMMAND_REQUIRES_IDLE_MESSAGE =
  'Wait for the active Run to finish, then submit this command again. Your draft and attachments are kept.'

export function isGuiOnlyComposerCommand(text: string) {
  return parseCompactCommand(text) !== null || parseSessionCopyCommand(text) !== null
}
