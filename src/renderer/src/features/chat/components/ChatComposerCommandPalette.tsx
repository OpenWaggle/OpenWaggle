import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WagglePreset } from '@shared/types/waggle'
import { CommandPalette } from '@/features/command-palette/components'

interface ChatComposerCommandPaletteProps {
  readonly open: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
  readonly onStartWaggle: (preset: WagglePreset) => void
  readonly onOpenSessionTree?: () => void
  readonly onForkToNewSession: () => void
  readonly onCloneToNewSession: () => void
}

/** Command palette overlay slot above the composer (extracted to keep ChatComposerStack small). */
export function ChatComposerCommandPalette(props: ChatComposerCommandPaletteProps) {
  if (!props.open) return null
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
      <CommandPalette
        slashSkills={props.slashSkills}
        onSelectSkill={props.onSelectSkill}
        onStartWaggle={props.onStartWaggle}
        onOpenSessionTree={props.onOpenSessionTree}
        onForkToNewSession={props.onForkToNewSession}
        onCloneToNewSession={props.onCloneToNewSession}
      />
    </div>
  )
}
