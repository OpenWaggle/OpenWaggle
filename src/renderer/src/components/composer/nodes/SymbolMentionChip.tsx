import { Code } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SymbolKind } from './SymbolMentionNode'

const ICON_SIZE = 12

interface SymbolMentionChipProps {
  symbolName: string
  kind: SymbolKind
}

export function SymbolMentionChip({ symbolName }: SymbolMentionChipProps) {
  return (
    <span
      className={cn(
        'bg-success/10 text-success rounded px-1.5 py-0.5 text-[13px]',
        'inline-flex items-center gap-1',
        'select-none cursor-default',
      )}
    >
      <Code size={ICON_SIZE} className="shrink-0" />
      <span className="truncate max-w-[200px] font-mono">{symbolName}</span>
    </span>
  )
}
