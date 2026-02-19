import { cn } from '@/lib/cn'

type LineType = 'add' | 'remove' | 'context'

interface DiffLineProps {
  type: LineType
  lineNumber: number | null
  content: string
  onClick: () => void
  isSelected: boolean
}

export function DiffLine({
  type,
  lineNumber,
  content,
  onClick,
  isSelected,
}: DiffLineProps): React.JSX.Element {
  const mark = type === 'add' ? ' +' : type === 'remove' ? ' -' : '  '

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center h-5 w-full text-left',
        type === 'remove' && 'bg-diff-remove-bg',
        type === 'add' && 'bg-diff-add-bg',
        type === 'context' && 'bg-diff-bg',
        isSelected && 'ring-1 ring-inset ring-accent/40',
      )}
    >
      {/* Line number */}
      <span
        className={cn(
          'shrink-0 w-8 text-right font-mono text-[10px] leading-5 select-none',
          type === 'remove' && 'text-diff-remove-num',
          type === 'add' && 'text-diff-add-num',
          type === 'context' && 'text-text-tertiary',
        )}
      >
        {lineNumber ?? ''}
      </span>

      {/* Mark (+/-/space) */}
      <span
        className={cn(
          'shrink-0 w-4 font-mono text-[10px] leading-5 select-none',
          type === 'remove' && 'text-diff-remove-text',
          type === 'add' && 'text-diff-add-mark',
          type === 'context' && 'text-text-tertiary',
        )}
      >
        {mark}
      </span>

      {/* Code content */}
      <span
        className={cn(
          'flex-1 font-mono text-[10px] leading-5 whitespace-pre truncate',
          type === 'remove' && 'text-diff-remove-text',
          type === 'add' && 'text-diff-add-text',
          type === 'context' && 'text-diff-context-text',
        )}
      >
        {content}
      </span>
    </button>
  )
}
