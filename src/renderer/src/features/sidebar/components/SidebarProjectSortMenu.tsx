import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUpNarrowWide,
  Calendar,
  CaseSensitive,
  Check,
  LayoutList,
  type LucideIcon,
} from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import {
  SIDEBAR_SORT_ORDERS,
  type SidebarSessionSortMode,
  type SidebarSortField,
  sidebarSortField,
  sidebarSortModeForField,
} from '../lib/sidebar-sort'
import { SidebarIconButton } from './SidebarSectionHead'

const SORT_MENU_LABEL = 'Sort projects and sessions'

const FIELD_OPTIONS: readonly {
  readonly field: SidebarSortField
  readonly label: string
  readonly icon: LucideIcon
}[] = [
  { field: 'date', label: 'Date', icon: Calendar },
  { field: 'name', label: 'Name', icon: CaseSensitive },
]

/** Orders read as plain words, so a screen reader says "A to Z" rather than "A dash greater Z". */
const ORDER_OPTIONS: Readonly<
  Record<SidebarSessionSortMode, { readonly label: string; readonly icon: LucideIcon }>
> = {
  recent: { label: 'Newest first', icon: ArrowDownWideNarrow },
  oldest: { label: 'Oldest first', icon: ArrowUpNarrowWide },
  name: { label: 'A to Z', icon: ArrowDownAZ },
  'name-desc': { label: 'Z to A', icon: ArrowDownZA },
}

function SortMenuItem({
  checked,
  icon: Icon,
  label,
  onSelect,
}: {
  readonly checked: boolean
  readonly icon: LucideIcon
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="row"
      size="xs"
      radius="none"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn('gap-2 px-3 text-xs', checked && 'text-accent')}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {checked ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
    </Button>
  )
}

/**
 * The Projects sort menu: a Sort by group (date or name) and an Order group for that field.
 *
 * Each group is its own radio set, so it is a `group` named by its visible heading. The heading
 * is hidden from the accessibility tree because the group already announces it. Picking an item
 * keeps the menu open, since a sort is two choices; Escape, Tab, the trigger or a click outside
 * closes it. The Popover's `menu` role supplies the keyboard model: arrow keys, Home and End move
 * across both groups, and focus opens on the checked field and returns to the trigger on close.
 */
export function SidebarProjectSortMenu({
  open,
  sortMode,
  onSetOpen,
  onSetSortMode,
}: {
  readonly open: boolean
  readonly sortMode: SidebarSessionSortMode
  readonly onSetOpen: (open: boolean) => void
  readonly onSetSortMode: (mode: SidebarSessionSortMode) => void
}) {
  const sortByHeadingId = useId()
  const orderHeadingId = useId()
  const field = sidebarSortField(sortMode)

  return (
    <Popover
      open={open}
      onOpenChange={onSetOpen}
      placement="bottom-end"
      className="min-w-49 py-1"
      role="menu"
      ariaLabel={SORT_MENU_LABEL}
      trigger={
        <SidebarIconButton label={SORT_MENU_LABEL} isActive={open} onClick={() => onSetOpen(!open)}>
          <LayoutList className="size-3.5" />
        </SidebarIconButton>
      }
    >
      <div role="group" aria-labelledby={sortByHeadingId}>
        <SortMenuHeading id={sortByHeadingId}>Sort by</SortMenuHeading>
        {FIELD_OPTIONS.map((option) => (
          <SortMenuItem
            key={option.field}
            checked={field === option.field}
            icon={option.icon}
            label={option.label}
            onSelect={() => onSetSortMode(sidebarSortModeForField(sortMode, option.field))}
          />
        ))}
      </div>
      <hr className="my-1 border-border-light" />
      <div role="group" aria-labelledby={orderHeadingId}>
        <SortMenuHeading id={orderHeadingId}>Order</SortMenuHeading>
        {SIDEBAR_SORT_ORDERS[field].map((mode) => (
          <SortMenuItem
            key={mode}
            checked={sortMode === mode}
            icon={ORDER_OPTIONS[mode].icon}
            label={ORDER_OPTIONS[mode].label}
            onSelect={() => onSetSortMode(mode)}
          />
        ))}
      </div>
    </Popover>
  )
}

function SortMenuHeading({ id, children }: { readonly id: string; readonly children: string }) {
  return (
    <div
      id={id}
      aria-hidden="true"
      className="px-3 pt-1.5 pb-0.5 font-medium text-text-muted text-xs uppercase tracking-wider"
    >
      {children}
    </div>
  )
}
