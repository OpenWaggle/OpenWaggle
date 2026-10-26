import { ChevronDown, ChevronRight, PanelRight } from 'lucide-react'
import { Fragment, type Key, type ReactNode, type Ref, useId, useState } from 'react'
import { cn } from '@/shared/lib/cn'
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

/** The header row's geometry, shared by a disclosure header and a link section's row. */
const SECTION_ROW_CLASS = 'flex min-h-10 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left'

/**
 * A fact's separator width and the list's left shift that clips it at each line start. They are
 * one length: change them together, or every wrapped line starts indented or cut.
 */
const FACT_SEPARATOR = { width: 'w-3', shift: '-ml-3' } as const

/**
 * Where a link section goes: `label` is the destination (the trailing icon's tooltip) and
 * `accessibleName` the whole row's name, which repeats what the row shows.
 */
export interface SessionSummaryLinkTarget {
  readonly label: string
  readonly accessibleName: string
  readonly onOpen: () => void
}

/**
 * A Summary section that is a single row standing for a surface shown elsewhere, such as the
 * Hive panel. It sits where a section header sits and reads like one: the icon, a title line,
 * and optional detail lines under it. With a `target` the whole row is one button that opens
 * it, with the same full-row hover and a trailing panel icon; it holds no other control.
 * Without one the row is plain content and has no icon.
 */
export function SessionSummaryLinkSection({
  label,
  icon,
  title,
  details,
  target,
}: {
  /** The region's name. */
  readonly label: string
  readonly icon: ReactNode
  readonly title: string
  readonly details?: ReactNode
  readonly target?: SessionSummaryLinkTarget
}) {
  const content = (
    <>
      {/* The leading icon belongs to the title line; only the trailing icon centres on the row. */}
      <span aria-hidden="true" className="flex h-5 shrink-0 items-center self-start">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-primary">{title}</span>
        {details}
      </span>
    </>
  )
  return (
    <section aria-label={label} className="border-t border-border first:border-t-0">
      {target === undefined ? (
        <div className={SECTION_ROW_CLASS}>{content}</div>
      ) : (
        <Button
          variant="unstyled"
          // Keyboard focus only: the row stays focused after a click, and `focus:` would keep it
          // painted as if hovered (MEMORY.md, "A focused row keeps its focus").
          className={cn(
            SECTION_ROW_CLASS,
            'group cursor-pointer transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover',
          )}
          aria-label={target.accessibleName}
          onClick={target.onOpen}
        >
          {content}
          <span
            title={target.label}
            className="grid size-6 shrink-0 place-items-center text-text-muted transition-colors group-hover:text-text-secondary group-focus-visible:text-text-secondary"
          >
            <PanelRight aria-hidden="true" className="size-3.5" />
          </span>
        </Button>
      )}
    </section>
  )
}

/**
 * Short facts under a link section's title ("3 direct Workers · 1 needs you"). Each one is a
 * single unbreakable item that shortens with an ellipsis when it alone is wider than the row,
 * and the items wrap only between each other. Every item leads with its separator, and the list
 * is shifted left by one separator inside a clipping box, so a line never starts with a dot.
 */
export function SessionSummaryFacts({
  items,
}: {
  readonly items: readonly {
    readonly key: string
    readonly text: string
    readonly className?: string
  }[]
}) {
  if (items.length === 0) return null
  return (
    <span className="block overflow-hidden text-xs text-text-tertiary">
      <span className={cn(FACT_SEPARATOR.shift, 'flex flex-wrap')}>
        {items.map((item) => (
          <span key={item.key} data-summary-fact="" className="flex min-w-0 max-w-full">
            <span
              aria-hidden="true"
              className={cn(FACT_SEPARATOR.width, 'shrink-0 text-center whitespace-pre')}
            >
              {' · '}
            </span>
            <span className={cn('min-w-0 truncate', item.className)}>{item.text}</span>
          </span>
        ))}
      </span>
    </span>
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
