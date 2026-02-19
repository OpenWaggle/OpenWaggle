import { cn } from '@/lib/cn'
import type { DiffResult } from '@/lib/diff'

interface DiffViewProps {
  diff: DiffResult
  filePath: string
}

export function DiffView({ diff, filePath }: DiffViewProps): React.JSX.Element {
  return (
    <div className="rounded-md border border-border overflow-hidden text-[14px] font-mono">
      {/* File header */}
      <div className="flex items-center justify-between bg-bg-secondary px-3 py-1.5 border-b border-border">
        <span className="text-text-secondary truncate">{filePath}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {diff.additions > 0 && <span className="text-success">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="text-error">-{diff.deletions}</span>}
        </div>
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto bg-bg">
        {diff.lines.map((line, i) => (
          <div
            key={`${String(i)}-${line.type}`}
            className={cn(
              'flex whitespace-pre',
              line.type === 'add' && 'bg-success/10',
              line.type === 'remove' && 'bg-error/10',
            )}
          >
            {/* Line numbers */}
            <span className="shrink-0 w-10 text-right pr-2 select-none text-text-muted/50 border-r border-border">
              {line.oldLineNumber ?? ' '}
            </span>
            <span className="shrink-0 w-10 text-right pr-2 select-none text-text-muted/50 border-r border-border">
              {line.newLineNumber ?? ' '}
            </span>

            {/* Indicator */}
            <span
              className={cn(
                'shrink-0 w-5 text-center select-none',
                line.type === 'add' && 'text-success',
                line.type === 'remove' && 'text-error',
              )}
            >
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>

            {/* Content */}
            <span
              className={cn(
                'flex-1 pr-3',
                line.type === 'add' && 'text-success',
                line.type === 'remove' && 'text-error',
                line.type === 'context' && 'text-text-secondary',
              )}
            >
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
