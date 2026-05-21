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
    <div className="mb-2 flex items-center gap-1.5">
      <TextInput
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search branches"
        inputSize="sm"
        className="flex-1 border-border px-2 text-[12px]"
      />
      {isBranchActionRunning ? <Loader2 className="size-3.5 animate-spin text-accent" /> : null}
    </div>
  )
}
