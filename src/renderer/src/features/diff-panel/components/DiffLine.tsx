import { match } from '@diegogbrisa/ts-match'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

type LineType = 'add' | 'remove' | 'context'

interface DiffLineProps {
  type: LineType
  lineNumber: number | null
  content: string
  onClick: () => void
  isSelected: boolean
}

interface DiffLineViewModel {
  readonly mark: string
  readonly buttonClassName: string
  readonly lineNumberClassName: string
  readonly markClassName: string
  readonly contentClassName: string
}

function getDiffLineViewModel(type: LineType): DiffLineViewModel {
  return match(type)
    .with('add', () => ({
      mark: ' +',
      buttonClassName: 'bg-diff-add-bg hover:bg-[#133d24]',
      lineNumberClassName: 'text-diff-add-num',
      markClassName: 'text-diff-add-mark',
      contentClassName: 'text-diff-add-text',
    }))
    .with('remove', () => ({
      mark: ' -',
      buttonClassName: 'bg-diff-remove-bg hover:bg-[#3d1a1e]',
      lineNumberClassName: 'text-diff-remove-num',
      markClassName: 'text-diff-remove-text',
      contentClassName: 'text-diff-remove-text',
    }))
    .with('context', () => ({
      mark: '  ',
      buttonClassName: 'bg-diff-bg hover:bg-[#151820]',
      lineNumberClassName: 'text-text-tertiary',
      markClassName: 'text-text-tertiary',
      contentClassName: 'text-diff-context-text',
    }))
    .exhaustive()
}

export function DiffLine({ type, lineNumber, content, onClick, isSelected }: DiffLineProps) {
  const view = getDiffLineViewModel(type)

  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-6 min-w-full w-max items-center text-left transition-[background-color] duration-75',
        view.buttonClassName,
        isSelected && 'ring-1 ring-inset ring-accent/40',
      )}
    >
      {/* Line number */}
      <span
        className={cn(
          'shrink-0 w-8 text-right font-mono text-[13px] leading-6 select-none',
          view.lineNumberClassName,
        )}
      >
        {lineNumber ?? ''}
      </span>

      {/* Mark (+/-/space) */}
      <span
        className={cn(
          'shrink-0 w-4 font-mono text-[13px] leading-6 select-none',
          view.markClassName,
        )}
      >
        {view.mark}
      </span>

      {/* Code content */}
      <span
        className={cn('pr-3 font-mono text-[13px] leading-6 whitespace-pre', view.contentClassName)}
      >
        {content}
      </span>
    </Button>
  )
}
