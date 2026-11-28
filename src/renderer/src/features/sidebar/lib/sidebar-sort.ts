import type { SessionSummary } from '@shared/types/session'

/**
 * The Projects sort: a field (date or name) and an order within it.
 *
 * One flat value rather than a field and a direction, so the persisted preference stays the
 * string it always was: `recent`, `oldest` and `name` from before the order choice existed
 * keep their meaning, and only `name-desc` is new.
 */
export type SidebarSessionSortMode = 'recent' | 'oldest' | 'name' | 'name-desc'

export type SidebarSortField = 'date' | 'name'

export const SIDEBAR_SORT_MODES: readonly SidebarSessionSortMode[] = [
  'recent',
  'oldest',
  'name',
  'name-desc',
]

/** The two orders each field offers. The first is what picking the field selects. */
export const SIDEBAR_SORT_ORDERS: Readonly<
  Record<SidebarSortField, readonly [SidebarSessionSortMode, SidebarSessionSortMode]>
> = {
  date: ['recent', 'oldest'],
  name: ['name', 'name-desc'],
}

const FIELD_BY_MODE: Readonly<Record<SidebarSessionSortMode, SidebarSortField>> = {
  recent: 'date',
  oldest: 'date',
  name: 'name',
  'name-desc': 'name',
}

export function sidebarSortField(mode: SidebarSessionSortMode) {
  return FIELD_BY_MODE[mode]
}

/** The mode picking `field` selects: unchanged when it is already the field in use. */
export function sidebarSortModeForField(current: SidebarSessionSortMode, field: SidebarSortField) {
  return sidebarSortField(current) === field ? current : SIDEBAR_SORT_ORDERS[field][0]
}

/** 1 for an ascending order (oldest first, A to Z), -1 for a descending one. */
const DIRECTION_BY_MODE: Readonly<Record<SidebarSessionSortMode, 1 | -1>> = {
  recent: -1,
  oldest: 1,
  name: 1,
  'name-desc': -1,
}

export function compareSessionsForSort(mode: SidebarSessionSortMode) {
  const direction = DIRECTION_BY_MODE[mode]
  return (left: SessionSummary, right: SessionSummary) =>
    direction *
    (sidebarSortField(mode) === 'name'
      ? left.title.localeCompare(right.title)
      : left.updatedAt - right.updatedAt)
}

/**
 * Order project paths for the sidebar.
 *
 * The name orders sort every project by the name the sidebar shows, sessionless ones included.
 * The date orders sort projects by when their first session was created, a date that never
 * changes, so activity never makes projects jump around. Sessionless projects have no such date
 * and stay after the rest, in the order they were given.
 */
export function orderSidebarProjectPaths(input: {
  readonly sessionProjectPaths: readonly string[]
  readonly sessionlessProjectPaths: readonly string[]
  readonly mode: SidebarSessionSortMode
  readonly projectLabel: (projectPath: string) => string
  readonly firstSessionCreatedAt: (projectPath: string) => number
}) {
  const direction = DIRECTION_BY_MODE[input.mode]
  if (sidebarSortField(input.mode) === 'name') {
    return [...input.sessionProjectPaths, ...input.sessionlessProjectPaths].sort(
      (left, right) =>
        direction *
        (input.projectLabel(left).localeCompare(input.projectLabel(right)) ||
          left.localeCompare(right)),
    )
  }
  const dated = [...input.sessionProjectPaths].sort(
    (left, right) =>
      direction * (input.firstSessionCreatedAt(left) - input.firstSessionCreatedAt(right)),
  )
  return [...dated, ...input.sessionlessProjectPaths]
}
