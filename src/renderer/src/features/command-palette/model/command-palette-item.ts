import type { WaggleConfig, WagglePreset } from '@shared/types/waggle'
import type { ReactNode } from 'react'

export interface CommandPaletteCallbacks {
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
  readonly onStartWaggle: (config: WaggleConfig) => void
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
  readonly action: () => void
}

export interface CommandPaletteActionHandlers {
  readonly closeCommandPalette: () => void
  readonly configureWaggle: () => void
  readonly selectPreset: (preset: WagglePreset) => void
  readonly startWaggle: () => void
  readonly selectSkill: (skillId: string, skillName?: string) => void
  readonly openSessionTree?: () => void
  readonly forkToNewSession?: () => void
  readonly cloneToNewSession?: () => void
  readonly insertCompactCommand: () => void
}
