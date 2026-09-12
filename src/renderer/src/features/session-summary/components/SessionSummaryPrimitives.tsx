import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, type Key, type ReactNode, type Ref, useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'

const INITIAL_VISIBLE_ITEMS = 6
const ADDITIONAL_VISIBLE_ITEMS = 50

export function SessionSummarySection({
  id,
  title,
  count,
  expanded,
  onExpandedChange,
  actions,
  sectionRef,
  triggerRef,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly count?: number
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly actions?: ReactNode
  readonly sectionRef?: Ref<HTMLElement>
  readonly triggerRef?: Ref<HTMLButtonElement>
  readonly children: ReactNode
}) {
  const contentId = `session-summary-section-${id}`
  return (
    <section ref={sectionRef} className="border-t border-border first:border-t-0">
      <div className="sticky top-0 z-10 flex h-10 items-center bg-bg-secondary/95 backdrop-blur">
        <Button
          ref={triggerRef}
          variant="unstyled"
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors hover:bg-bg-hover"
          aria-label={count === undefined ? title : `${title} ${count}`}
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {title}
          </span>
          {count === undefined ? null : (
            <span className="shrink-0 text-xs text-text-tertiary">{count}</span>
          )}
        </Button>
        {actions === undefined ? null : <div className="shrink-0 pr-2">{actions}</div>}
      </div>
      <div
        id={contentId}
        aria-hidden={!expanded}
        inert={!expanded}
        className={
          expanded
            ? 'grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none'
            : 'grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none'
        }
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-1 px-2 pb-2">{children}</div>
        </div>
      </div>
    </section>
  )
}

export function SessionSummaryRow({
  icon,
  label,
  value,
  onClick,
  disabledReason,
  ariaLabel,
}: {
  readonly icon?: ReactNode
  readonly label: string
  readonly value?: ReactNode
  readonly onClick?: () => void
  readonly disabledReason?: string
  readonly ariaLabel?: string
}) {
  const descriptionId = useId()
  const content = (
    <>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="shrink-0 text-text-tertiary">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{label}</span>
      {value === undefined ? null : <span className="shrink-0 text-sm">{value}</span>}
    </>
  )

  if (!onClick) {
    return <div className="flex min-h-8 items-center gap-2 px-2">{content}</div>
  }

  return (
    <>
      <Button
        variant="unstyled"
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-bg-hover focus:bg-bg-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        aria-label={ariaLabel}
        aria-disabled={disabledReason === undefined ? undefined : true}
        aria-describedby={disabledReason === undefined ? undefined : descriptionId}
        title={disabledReason}
        onClick={() => {
          if (disabledReason === undefined) onClick()
        }}
      >
        {content}
      </Button>
      {disabledReason === undefined ? null : (
        <span id={descriptionId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}

export function SessionSummaryPaginatedList<Item>({
  items,
  getKey,
  renderItem,
}: {
  readonly items: readonly Item[]
  readonly getKey: (item: Item) => Key
  readonly renderItem: (item: Item) => ReactNode
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ITEMS)
  const resolvedVisibleCount = Math.min(visibleCount, items.length)
  const remainingCount = items.length - resolvedVisibleCount

  return (
    <>
      {items.slice(0, resolvedVisibleCount).map((item) => (
        <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
      ))}
      {remainingCount > 0 ? (
        <SessionSummaryRow
          label={`Show ${Math.min(remainingCount, ADDITIONAL_VISIBLE_ITEMS)} more`}
          icon={<ChevronRight className="size-3.5" />}
          onClick={() => setVisibleCount((current) => current + ADDITIONAL_VISIBLE_ITEMS)}
        />
      ) : items.length > INITIAL_VISIBLE_ITEMS ? (
        <SessionSummaryRow
          label="Show less"
          icon={<ChevronDown className="size-3.5" />}
          onClick={() => setVisibleCount(INITIAL_VISIBLE_ITEMS)}
        />
      ) : null}
    </>
  )
}
