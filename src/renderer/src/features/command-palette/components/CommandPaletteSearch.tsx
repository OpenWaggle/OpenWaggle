import { Search } from 'lucide-react'
import type { KeyboardEventHandler, RefObject } from 'react'
import { TextInput } from '@/shared/ui/TextInput'

interface CommandPaletteSearchProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly query: string
  readonly onKeyDown: KeyboardEventHandler<HTMLInputElement>
  readonly onQueryChange: (query: string) => void
}

export function CommandPaletteSearch({
  inputRef,
  query,
  onKeyDown,
  onQueryChange,
}: CommandPaletteSearchProps) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border px-3.5">
      <Search className="size-3.5 shrink-0 text-text-tertiary" />
      <TextInput
        ref={inputRef}
        type="text"
        value={query}
        onKeyDown={onKeyDown}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search"
        variant="transparent"
        inputSize="sm"
        className="flex-1 px-0"
      />
    </div>
  )
}
