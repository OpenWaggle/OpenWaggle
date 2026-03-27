import { FileText } from 'lucide-react'
import { cn } from '@/lib/cn'

const ICON_SIZE = 12

interface FileMentionChipProps {
  path: string
  basename: string
}

export function FileMentionChip({ path, basename }: FileMentionChipProps) {
  return (
    <span
      className={cn(
        'bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[13px]',
        'inline-flex items-center gap-1',
        'select-none cursor-default',
      )}
      title={path}
    >
      <FileText size={ICON_SIZE} className="shrink-0" />
      <span className="truncate max-w-[200px]">{basename}</span>
    </span>
  )
}
