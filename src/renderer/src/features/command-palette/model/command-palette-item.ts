import type { WagglePreset } from '@shared/types/waggle'
import type { ReactNode } from 'react'

export interface CommandPaletteCallbacks {
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
  readonly onStartWaggle: (preset: WagglePreset) => void
  readonly onOpenSessionTree?: (() => void) | undefined
  readonly onForkToNewSession?: (() => void) | undefined
  readonly onCloneToNewSession?: (() => void) | undefined
}

export interface CommandPaletteItem {
  readonly id: string
  readonly label: string
  readonly description?: string | undefined
  readonly icon: ReactNode
  readonly section?: string | undefined
  readonly trailing?: string | undefined
  readonly trailingBadge?: string | undefined
  readonly disabled?: boolean | undefined
  /** When the typed command is the whole draft, leave Enter to the composer to submit it. */
  readonly submitsOnEnter?: boolean | undefined
  readonly action: () => void
}

export interface CommandPaletteActionHandlers {
  readonly closeSlashCommandMenu: () => void
  readonly configureWaggle: () => void
  readonly selectPreset: (preset: WagglePreset) => void
  readonly selectSkill: (skillId: string, skillName?: string) => void
}
