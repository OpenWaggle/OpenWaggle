import type { WagglePreset } from '@shared/types/waggle'
import type { ReactNode } from 'react'

export interface CommandPaletteCallbacks {
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
  readonly onStartWaggle: (preset: WagglePreset) => void
  readonly onOpenSessionTree?: () => void
  readonly onForkToNewSession?: () => void
  readonly onCloneToNewSession?: () => void
}

export interface CommandPaletteItem {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly icon: ReactNode
  readonly section?: string
  readonly trailing?: string
  readonly trailingBadge?: string
  readonly disabled?: boolean
  /** When the typed command is the whole draft, leave Enter to the composer to submit it. */
  readonly submitsOnEnter?: boolean
  readonly action: () => void
}

export interface CommandPaletteActionHandlers {
  readonly closeSlashCommandMenu: () => void
  readonly configureWaggle: () => void
  readonly selectPreset: (preset: WagglePreset) => void
  readonly selectSkill: (skillId: string, skillName?: string) => void
}
