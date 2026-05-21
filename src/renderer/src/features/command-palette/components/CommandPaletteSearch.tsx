import { Search } from 'lucide-react'
import type { RefObject } from 'react'
import { TextInput } from '@/shared/ui/TextInput'

interface CommandPaletteSearchProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly query: string
  readonly onQueryChange: (query: string) => void
}

export function CommandPaletteSearch({
  inputRef,
  query,
  onQueryChange,
}: CommandPaletteSearchProps) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border px-3.5">
      <Search className="size-3.5 shrink-0 text-text-tertiary" />
      <TextInput
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search"
        variant="transparent"
        inputSize="sm"
        className="flex-1 px-0"
      />
    </div>
  )
}
