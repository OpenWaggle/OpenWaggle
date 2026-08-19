import { Search } from 'lucide-react'
import { SIDEBAR_SEARCH_HOTKEY_LABEL } from '../constants/sidebar-layout'

/**
 * Filter projects and sessions by text.
 *
 * Present in the approved prototype for a stated reason: forty sessions across a dozen projects
 * are not scannable, and the alternative to searching is scrolling and hoping. It sits above the
 * chips so the two narrowing tools are together, and it narrows the tree rather than navigating
 * away from it.
 *
 * Metrics are the prototype's: a 28px field inset 8px, an 8px gutter, and a shortcut hint on the
 * right so the keyboard route is advertised where it is used.
 */
export function SidebarSearchBox({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="flex-none px-2 pt-1 pb-2">
      <div
        data-qa="sidebar-search"
        className="sidebar-search flex h-7 items-center gap-1.5 rounded-md border border-border-light bg-bg px-2 text-text-tertiary"
      >
        <Search className="size-3.5 flex-none" />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Filter projects and sessions"
          placeholder="Filter projects and sessions…"
          className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-tertiary"
        />
        <span
          aria-hidden="true"
          className="flex-none rounded border border-border-light bg-bg-tertiary px-1 py-0.5 font-mono text-[10px] text-text-muted leading-none"
        >
          {SIDEBAR_SEARCH_HOTKEY_LABEL}
        </span>
      </div>
    </div>
  )
}
