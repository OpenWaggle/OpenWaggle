import { Loader2 } from 'lucide-react'
import { TextInput } from '@/shared/ui/TextInput'

interface BranchPickerSearchProps {
  readonly query: string
  readonly isBranchActionRunning: boolean
  readonly onQueryChange: (query: string) => void
}

export function BranchPickerSearch({
  query,
  isBranchActionRunning,
  onQueryChange,
}: BranchPickerSearchProps) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <TextInput
        aria-label="Search branches"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search branches"
        inputSize="sm"
        className="flex-1 border-border-light bg-bg px-2 text-xs"
      />
      {isBranchActionRunning ? <Loader2 className="size-3.5 animate-spin text-accent" /> : null}
    </div>
  )
}
