import type { MultiAgentConfig, TeamPreset } from '@shared/types/multi-agent'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { choose } from '@shared/utils/decision'
import {
  GitBranch,
  GitPullRequest,
  Layers,
  MessageSquare,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Smile,
  Swords,
  User,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useMultiAgentStore } from '@/stores/multi-agent-store'
import { useUIStore } from '@/stores/ui-store'

// ── Types ──

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  section?: string
  /** Extra trailing text (mode badge, project tag, etc.) */
  trailing?: string
  trailingBadge?: string
  action: () => void
}

// ── Component ──

interface CommandPaletteProps {
  slashSkills: readonly SkillDiscoveryItem[]
  onSelectSkill: (skillId: string) => void
  onStartWaggle: (config: MultiAgentConfig) => void
}

export function CommandPalette({
  slashSkills,
  onSelectSkill,
  onStartWaggle,
}: CommandPaletteProps): React.JSX.Element {
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette)
  const openSettings = useUIStore((s) => s.openSettings)
  const setConfig = useMultiAgentStore((s) => s.setConfig)

  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [presets, setPresets] = useState<TeamPreset[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    void api.listTeams().then(setPresets)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeCommandPalette()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeCommandPalette])

  const lowerQuery = query.toLowerCase().trim()

  // ── Waggle handlers ──

  function handleSelectPreset(preset: TeamPreset): void {
    setConfig(preset.config)
    onStartWaggle(preset.config)
    closeCommandPalette()
  }

  function handleConfigureWaggle(): void {
    closeCommandPalette()
    openSettings('waggle')
  }

  function handleStartWaggle(): void {
    const config = useMultiAgentStore.getState().activeConfig
    if (config) {
      onStartWaggle(config)
      closeCommandPalette()
    } else {
      handleConfigureWaggle()
    }
  }

  function handleSkillSelect(skillId: string): void {
    onSelectSkill(skillId)
    closeCommandPalette()
  }

  // ── Build items ──

  const baseCommands: CommandItem[] = [
    {
      id: 'waggle',
      label: 'Waggle Mode',
      description: 'Start LLM collaboration session',
      icon: <Users className="h-3.5 w-3.5" />,
      action: handleStartWaggle,
    },
    {
      id: 'code-review',
      label: 'Code review',
      icon: <GitPullRequest className="h-3.5 w-3.5" />,
      action: () => closeCommandPalette(),
    },
    {
      id: 'feedback',
      label: 'Feedback',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      action: () => closeCommandPalette(),
    },
    {
      id: 'new-worktree',
      label: 'New worktree',
      icon: <GitBranch className="h-3.5 w-3.5" />,
      action: () => closeCommandPalette(),
    },
    {
      id: 'personality',
      label: 'Personality',
      icon: <Smile className="h-3.5 w-3.5" />,
      action: () => closeCommandPalette(),
    },
    {
      id: 'plan-mode',
      label: 'Plan mode',
      description: 'Turn plan mode on',
      icon: <Layers className="h-3.5 w-3.5" />,
      action: () => closeCommandPalette(),
    },
  ]

  // Skills
  const enabledSkills = slashSkills.filter((s) => s.enabled && s.loadStatus === 'ok')
  const skillItems: CommandItem[] = enabledSkills
    .filter(
      (s) =>
        !lowerQuery ||
        s.name.toLowerCase().includes(lowerQuery) ||
        s.id.includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery),
    )
    .map((s) => ({
      id: `skill-${s.id}`,
      label: s.name,
      description: truncate(s.description, 50),
      icon: <Shield className="h-3.5 w-3.5" />,
      section: 'Skills',
      trailing: undefined,
      action: () => handleSkillSelect(s.id),
    }))

  // Waggle presets
  const wagglePresetItems: CommandItem[] = presets
    .filter(
      (p) =>
        !lowerQuery || p.name.toLowerCase().includes(lowerQuery) || 'waggle'.includes(lowerQuery),
    )
    .map((preset) => ({
      id: `waggle-preset-${preset.id}`,
      label: preset.name,
      description: truncate(preset.description, 40),
      icon: presetIcon(preset),
      section: 'Waggle Mode',
      trailing: preset.config.mode === 'sequential' ? 'Sequential' : 'Parallel',
      trailingBadge: preset.isBuiltIn ? undefined : 'Custom',
      action: () => handleSelectPreset(preset),
    }))

  // Filter base commands
  const filteredCommands = lowerQuery
    ? baseCommands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(lowerQuery) ||
          cmd.description?.toLowerCase().includes(lowerQuery),
      )
    : baseCommands

  // Waggle expanded view (when searching "waggle")
  const isWaggleFilter =
    lowerQuery.length > 0 && 'waggle'.includes(lowerQuery) && !lowerQuery.startsWith('waggle ')
  const configureItem: CommandItem | null = isWaggleFilter
    ? {
        id: 'configure-waggle',
        label: 'Configure Waggle Mode...',
        description: 'Open Waggle Mode settings',
        icon: <Settings className="h-3.5 w-3.5" />,
        section: 'configure',
        action: handleConfigureWaggle,
      }
    : null

  const allItems = [
    ...filteredCommands,
    ...skillItems,
    ...wagglePresetItems,
    ...(configureItem ? [configureItem] : []),
  ]

  // ── Keyboard navigation ──

  function scrollHighlightedIntoView(): void {
    requestAnimationFrame(() => {
      const highlighted = listRef.current?.querySelector('[data-highlighted="true"]')
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  function updateQuery(value: string): void {
    setQuery(value)
    setHighlightIndex(0)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    choose(e.key)
      .case('ArrowDown', () => {
        e.preventDefault()
        setHighlightIndex((prev) => (prev + 1) % allItems.length)
        scrollHighlightedIntoView()
      })
      .case('ArrowUp', () => {
        e.preventDefault()
        setHighlightIndex((prev) => (prev === 0 ? allItems.length - 1 : prev - 1))
        scrollHighlightedIntoView()
      })
      .case('Enter', () => {
        if (!allItems[highlightIndex]) return
        e.preventDefault()
        allItems[highlightIndex].action()
      })
      .catchAll(() => undefined)
  }

  // Track section boundaries for headers
  let lastSection: string | undefined

  return (
    <div
      role="listbox"
      className="w-full rounded-xl border border-[#2a2f3a] bg-[#161a20] overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Search bar */}
      <div className="flex items-center gap-2 h-11 px-3.5 border-b border-border">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => updateQuery(e.target.value)}
          placeholder="Search"
          className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </div>

      {/* Item list */}
      <div ref={listRef} className="max-h-[400px] overflow-y-auto">
        {allItems.length === 0 && (
          <div className="flex items-center justify-center h-16 text-[13px] text-text-muted">
            No matching commands
          </div>
        )}
        {allItems.map((item, i) => {
          const showSectionHeader =
            item.section && item.section !== 'configure' && item.section !== lastSection
          const showSeparator = item.section === 'configure' && lastSection !== 'configure'
          lastSection = item.section

          return (
            <div key={item.id}>
              {showSectionHeader && (
                <div
                  className={cn(
                    'flex items-center h-7 px-3.5',
                    lastSection === item.section && 'border-t border-border',
                  )}
                >
                  <span className="text-[11px] font-medium text-text-muted">{item.section}</span>
                </div>
              )}
              {showSeparator && <div className="border-t border-border" />}
              <button
                type="button"
                data-highlighted={i === highlightIndex}
                onClick={item.action}
                onMouseEnter={() => setHighlightIndex(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 h-10 px-3.5 text-left transition-colors',
                  i === highlightIndex
                    ? 'bg-[#1e2229] text-text-primary'
                    : 'text-text-secondary hover:bg-[#1e2229]/50',
                )}
              >
                <span
                  className={cn(
                    'shrink-0',
                    i === highlightIndex ? 'text-text-primary' : 'text-text-muted',
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium shrink-0">{item.label}</span>
                {item.description && (
                  <span className="text-[12px] text-text-muted truncate">{item.description}</span>
                )}
                {/* Trailing content pushed to right */}
                {(item.trailing || item.trailingBadge) && (
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {item.trailingBadge && (
                      <span className="rounded-full bg-[#1e2229] px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                        {item.trailingBadge}
                      </span>
                    )}
                    {item.trailing && (
                      <span className="text-[11px] text-text-muted">{item.trailing}</span>
                    )}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Helpers ──

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function presetIcon(preset: TeamPreset): React.ReactNode {
  const name = preset.name.toLowerCase()
  if (name.includes('review')) return <GitPullRequest className="h-3.5 w-3.5" />
  if (name.includes('debate')) return <Swords className="h-3.5 w-3.5" />
  if (name.includes('red team')) return <ShieldAlert className="h-3.5 w-3.5" />
  if (name.includes('qa') || name.includes('test')) return <Shield className="h-3.5 w-3.5" />
  return <User className="h-3.5 w-3.5" />
}
