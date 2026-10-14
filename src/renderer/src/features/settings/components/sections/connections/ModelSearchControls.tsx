import type { ModelDisplayInfo } from '@shared/types/llm'
import { Search, X } from 'lucide-react'
import type { Ref } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'

interface ModelSearchFieldProps {
  readonly inputRef?: Ref<HTMLInputElement>
  readonly value: string
  readonly onChange: (value: string) => void
}

export function ModelSearchField({ inputRef, value, onChange }: ModelSearchFieldProps) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-tertiary"
        aria-hidden="true"
      />
      <TextInput
        ref={inputRef}
        type="search"
        inputSize="sm"
        aria-label="Search models"
        placeholder="Search by name, model ID or provider…"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Escape clears the search first; a second Escape reaches the settings view.
          if (event.key === 'Escape' && value) {
            event.stopPropagation()
            onChange('')
          }
        }}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          radius="sm"
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

interface ModelMatchActionsProps {
  readonly matching: readonly ModelDisplayInfo[]
  readonly selectedCount: number
  readonly onSelect: (models: readonly ModelDisplayInfo[]) => void
  readonly onDeselect: (models: readonly ModelDisplayInfo[]) => void
  readonly onReset: () => void
}

const QUIET_ACTION_CLASS = 'text-xs text-text-tertiary hover:text-text-secondary'

/** Bulk actions over the models the current search and filters show. */
export function ModelMatchActions({
  matching,
  selectedCount,
  onSelect,
  onDeselect,
  onReset,
}: ModelMatchActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
      <span className="tabular-nums">
        {matching.length} matching · {selectedCount} selected
      </span>
      <span className="flex flex-wrap gap-3">
        {matching.length > 0 && (
          <>
            <Button
              variant="link"
              size="none"
              type="button"
              className="text-xs"
              onClick={() => onSelect(matching)}
            >
              Select all {matching.length} matching
            </Button>
            <Button
              variant="unstyled"
              type="button"
              className={QUIET_ACTION_CLASS}
              onClick={() => onDeselect(matching)}
            >
              Deselect matching
            </Button>
          </>
        )}
        <Button variant="unstyled" type="button" className={QUIET_ACTION_CLASS} onClick={onReset}>
          Reset filters
        </Button>
      </span>
    </div>
  )
}
