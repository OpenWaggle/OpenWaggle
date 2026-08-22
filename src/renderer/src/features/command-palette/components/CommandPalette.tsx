import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WagglePreset } from '@shared/types/waggle'
import { useEffect, useRef } from 'react'
import { useComposerStore } from '@/features/composer/state'
import { useClickOutside } from '@/shared/hooks/useClickOutside'
import { useUIStore } from '@/shell/ui-store'
import { useCommandPaletteItems } from '../hooks/useCommandPaletteItems'
import { useCommandPaletteKeyboard } from '../hooks/useCommandPaletteKeyboard'
import { CommandPaletteList } from './CommandPaletteList'

interface CommandPaletteProps {
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly onSelectSkill: (skillId: string, skillName?: string) => void
  readonly onStartWaggle: (preset: WagglePreset) => void
  readonly onOpenSessionTree?: () => void
  readonly onForkToNewSession?: () => void
  readonly onCloneToNewSession?: () => void
}

export function CommandPalette({
  slashSkills,
  onSelectSkill,
  onStartWaggle,
  onOpenSessionTree,
  onForkToNewSession,
  onCloneToNewSession,
}: CommandPaletteProps) {
  const closeSlashCommandMenu = useUIStore((s) => s.closeSlashCommandMenu)
  const editor = useComposerStore((s) => s.lexicalEditor)
  const activeSlashCommand = useComposerStore((s) => s.activeSlashCommand)
  const highlightIndex = useComposerStore((s) => s.slashHighlightIndex)
  const setHighlightIndex = useComposerStore((s) => s.setSlashHighlightIndex)
  const setDismissedSlashToken = useComposerStore((s) => s.setDismissedSlashToken)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const query = activeSlashCommand?.query ?? ''
  const items = useCommandPaletteItems({
    query,
    slashSkills,
    onSelectSkill,
    onStartWaggle,
    onOpenSessionTree,
    onForkToNewSession,
    onCloneToNewSession,
  })
  function dismiss() {
    setDismissedSlashToken(activeSlashCommand?.token ?? null)
    closeSlashCommandMenu()
  }
  useCommandPaletteKeyboard({
    editor,
    items,
    highlightIndex,
    setHighlightIndex,
    listRef,
    onClose: dismiss,
  })
  useClickOutside(containerRef, dismiss)

  useEffect(() => {
    if (highlightIndex >= items.length) setHighlightIndex(0)
  }, [highlightIndex, items.length, setHighlightIndex])

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Slash command menu"
      className="w-full overflow-hidden rounded-xl border border-[#2a2f3a] bg-[#161a20] shadow-xl"
    >
      <CommandPaletteList
        items={items}
        highlightIndex={highlightIndex}
        onHighlightIndexChange={setHighlightIndex}
        listRef={listRef}
      />
    </div>
  )
}
