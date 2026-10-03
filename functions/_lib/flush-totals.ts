/**
 * One day's buffered entries added up, and the small-cell rules applied before anything is
 * published (ADR 0044). An entry holds one install's report of one day, so the rules count
 * contributing entries, not events: counting events would let a single install with many Runs
 * pass alone and publish its whole day.
 */
import { type BufferEntry, COUNT_FIELD, type CountRow, type SumRow } from './buffer-entry'

/**
 * Fewest distinct entries, that is install-days, in any group of entries that a published row
 * describes or that can be worked out from it. Event totals, the `_count` rows, are always
 * published, so for every published value both groups count: the entries that reported it, and
 * the entries of the same event that did not, which `_count` minus the value reveals. Each must
 * hold no entry or at least this many. In every breakdown of a day's event by one field:
 *
 * - a value or list item failing that rule is folded into `(other)`, and `(other)` obeys the
 *   same rule: while it fails, the published values with the fewest entries are folded into it;
 * - when that leaves no value to publish, the breakdown is not published at all;
 * - an integer field's sum and count are published only when the entries that reported it pass
 *   the same rule.
 *
 * Fields an entry can leave out, such as feature flags, MCP servers, skills and any list item,
 * are covered by the same rule, since the entries lacking a value include those that omitted
 * the field. A day with fewer entries than this publishes event totals and nothing else.
 */
export const MIN_CONTRIBUTING_ENTRIES = 5
export const OTHER_VALUE = '(other)'

interface ValueTotal {
  readonly event: string
  readonly field: string
  readonly value: string
  readonly count: number
  /** The entries, by position, that contributed to this value. */
  readonly contributors: ReadonlySet<number>
}

interface SumTotal {
  readonly event: string
  readonly field: string
  readonly sum: number
  readonly count: number
  readonly contributors: ReadonlySet<number>
}

export interface DayTotals {
  readonly day: string
  readonly values: readonly ValueTotal[]
  readonly sums: readonly SumTotal[]
}

/** What a day publishes: `[event, field, value, count]` and `[event, field, sum, count]` rows. */
export interface PublishedTotals {
  readonly day: string
  readonly counts: readonly CountRow[]
  readonly sums: readonly SumRow[]
}

/** One day's buffered entries added up, keeping for every value the entries behind it. */
export function addUpEntries(day: string, entries: readonly BufferEntry[]): DayTotals {
  const values = new Map<string, { -readonly [K in keyof ValueTotal]: ValueTotal[K] }>()
  const sums = new Map<string, { -readonly [K in keyof SumTotal]: SumTotal[K] }>()
  entries.forEach((entry, index) => {
    for (const [event, field, value, count] of entry.counts) {
      const key = JSON.stringify([event, field, value])
      const total = values.get(key) ?? { event, field, value, count: 0, contributors: new Set() }
      total.count += count
      total.contributors = new Set([...total.contributors, index])
      values.set(key, total)
    }
    for (const [event, field, sum, count] of entry.sums) {
      const key = JSON.stringify([event, field])
      const total = sums.get(key) ?? { event, field, sum: 0, count: 0, contributors: new Set() }
      total.sum += sum
      total.count += count
      total.contributors = new Set([...total.contributors, index])
      sums.set(key, total)
    }
  })
  return { day, values: [...values.values()], sums: [...sums.values()] }
}

function unionOf(totals: readonly { readonly contributors: ReadonlySet<number> }[]) {
  return new Set(totals.flatMap((total) => [...total.contributors]))
}

/**
 * Whether a group of entries may be published: it holds at least the minimum, and so do the
 * entries of its event outside it, unless there are none.
 */
function isPublishableGroup(group: ReadonlySet<number>, eventEntries: ReadonlySet<number>) {
  if (group.size < MIN_CONTRIBUTING_ENTRIES) return false
  const lacking = [...eventEntries].filter((entry) => !group.has(entry)).length
  return lacking === 0 || lacking >= MIN_CONTRIBUTING_ENTRIES
}

/** Fewest entries first, then fewest events, then by value, so folding is deterministic. */
function bySize(left: ValueTotal, right: ValueTotal) {
  return (
    left.contributors.size - right.contributors.size ||
    left.count - right.count ||
    left.value.localeCompare(right.value)
  )
}

/** The rows one breakdown may publish, following {@link MIN_CONTRIBUTING_ENTRIES}. */
function publishableBreakdown(
  group: readonly ValueTotal[],
  eventEntries: ReadonlySet<number>,
): CountRow[] {
  const publishable = (entries: ReadonlySet<number>) => isPublishableGroup(entries, eventEntries)
  const kept = group.filter((total) => publishable(total.contributors))
  const folded = group.filter((total) => !publishable(total.contributors))
  kept.sort(bySize)
  while (folded.length > 0 && !publishable(unionOf(folded))) {
    const smallest = kept.shift()
    if (smallest === undefined) break
    folded.push(smallest)
  }
  const [first] = group
  if (kept.length === 0 || first === undefined) return []
  const rows: CountRow[] = kept.map((total) => [total.event, total.field, total.value, total.count])
  const other = folded.reduce((sum, total) => sum + total.count, 0)
  if (other > 0) rows.push([first.event, first.field, OTHER_VALUE, other])
  return rows
}

/** The rows a day may publish under the small-cell rules. */
export function publishableTotals(totals: DayTotals): PublishedTotals {
  const counts: CountRow[] = []
  const eventEntries = new Map<string, ReadonlySet<number>>()
  const breakdowns = new Map<string, ValueTotal[]>()
  for (const total of totals.values) {
    if (total.field === COUNT_FIELD) {
      counts.push([total.event, total.field, total.value, total.count])
      eventEntries.set(total.event, total.contributors)
      continue
    }
    const key = JSON.stringify([total.event, total.field])
    breakdowns.set(key, [...(breakdowns.get(key) ?? []), total])
  }
  // Every entry counts its events, so an event's `_count` lists all entries that sent it.
  const entriesOf = (
    event: string,
    fallback: readonly { readonly contributors: ReadonlySet<number> }[],
  ) => eventEntries.get(event) ?? unionOf(fallback)
  for (const group of breakdowns.values()) {
    const [first] = group
    if (first !== undefined)
      counts.push(...publishableBreakdown(group, entriesOf(first.event, group)))
  }
  const sums = totals.sums
    .filter((total) => isPublishableGroup(total.contributors, entriesOf(total.event, [total])))
    .map((total): SumRow => [total.event, total.field, total.sum, total.count])
  return { day: totals.day, counts, sums }
}
