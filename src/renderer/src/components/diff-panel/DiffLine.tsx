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
        'flex h-5 min-w-full w-max items-center text-left transition-[background-color] duration-75',
        type === 'remove' && 'bg-diff-remove-bg hover:bg-[#3d1a1e]',
        type === 'add' && 'bg-diff-add-bg hover:bg-[#133d24]',
        type === 'context' && 'bg-diff-bg hover:bg-[#151820]',
        isSelected && 'ring-1 ring-inset ring-accent/40',
      )}
    >
      {/* Line number */}
      <span
        className={cn(
          'shrink-0 w-8 text-right font-mono text-[11px] leading-5 select-none',
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
          'shrink-0 w-4 font-mono text-[11px] leading-5 select-none',
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
          'pr-3 font-mono text-[11px] leading-5 whitespace-pre',
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
