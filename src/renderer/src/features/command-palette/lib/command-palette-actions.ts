import { compactCommandText } from '@/features/composer/commands'
import {
  consumeActiveSlashCommand,
  insertSlashCommandTextAtActiveSlash,
} from '@/features/composer/lib'
import { useUIStore } from '@/shell/ui-store'

export function createOptionalCommandPaletteAction(
  closeSlashCommandMenu: () => void,
  action?: () => void,
) {
  if (!action) return undefined
  return () => {
    consumeActiveSlashCommand()
    closeSlashCommandMenu()
    action()
  }
}

export function insertCompactCommand() {
  insertComposerCommandText(compactCommandText())
}

export function insertComposerCommandText(command: string) {
  insertSlashCommandTextAtActiveSlash(command)
}

export function openFeedbackModal() {
  const store = useUIStore.getState()
  consumeActiveSlashCommand()
  store.closeSlashCommandMenu()
  store.openFeedbackModal()
}
