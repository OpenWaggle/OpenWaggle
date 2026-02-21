import { cn } from '@/lib/cn'

export interface SlashSuggestion {
  readonly id: string
  readonly name: string
  readonly description: string
}

interface SlashMenuProps {
  readonly suggestions: SlashSuggestion[]
  readonly highlightIndex: number
  readonly onSelect: (skillId: string) => void
  readonly visible: boolean
}

export function SlashMenu({
  suggestions,
  highlightIndex,
  onSelect,
  visible,
}: SlashMenuProps): React.JSX.Element | null {
  if (!visible) return null

  return (
    <div className="absolute inset-x-4 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-light bg-bg-secondary py-1 shadow-lg">
      {suggestions.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(skill.id)
          }}
          className={cn(
            'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
            index === highlightIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/80',
          )}
        >
          <span className="mt-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary">
            /{skill.id}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-text-primary">
              {skill.name}
            </span>
            <span className="block truncate text-[11px] text-text-tertiary">
              {skill.description || 'No description'}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
