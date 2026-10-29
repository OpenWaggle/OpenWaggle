import { match } from '@diegogbrisa/ts-match'
import type {
  AutomaticWorktreeRemovalKeptReason,
  WorktreeAttention,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import { formatBytes } from '@/shared/lib/format'

const MS_PER_DAY = 86_400_000

/** Whole days between two times, never negative. */
export function daysBetween(from: number, to: number) {
  return Math.max(0, Math.floor((to - from) / MS_PER_DAY))
}

function plural(count: number, one: string, many: string) {
  return `${String(count)} ${count === 1 ? one : many}`
}

export function archivedAgo(archivedAt: number, now: number) {
  const days = daysBetween(archivedAt, now)
  return days === 0 ? 'Archived today' : `Archived ${plural(days, 'day', 'days')} ago`
}

/** One short reason a worktree needs a decision before it can go. */
export function attentionLabel(attention: WorktreeAttention) {
  return match(attention)
    .with({ kind: 'open-sessions' }, ({ count }) =>
      count === 1
        ? 'A Session that is not archived uses it'
        : `${String(count)} open Sessions use it`,
    )
    .with({ kind: 'uncommitted-changes' }, ({ count }) =>
      plural(count, 'uncommitted change', 'uncommitted changes'),
    )
    .with(
      { kind: 'unpublished-commits' },
      ({ count }) => `${plural(count, 'commit is', 'commits are')} not on a remote`,
    )
    .with({ kind: 'cleanup-failed' }, () => 'Workspace cleanup failed')
    .with({ kind: 'locked' }, () => 'Locked by Git')
    .with({ kind: 'unknown-state' }, () => 'Git could not report its changes')
    .with({ kind: 'unmanaged' }, () => 'Created outside OpenWaggle')
    .with({ kind: 'unrecorded' }, () => 'Not recorded by this OpenWaggle profile')
    .exhaustive()
}

/** Why Automatic worktree removal kept a worktree that is past its days. */
export function keptReasonLabel(reason: AutomaticWorktreeRemovalKeptReason) {
  return match(reason)
    .with('in-use', () => 'it is in use')
    .with('uncommitted-changes', () => 'it has uncommitted changes')
    .with('unpublished-commits', () => 'it has commits that are not on a remote')
    .with('cleanup-failed', () => 'its Workspace cleanup failed')
    .with('locked', () => 'Git has it locked')
    .with('unknown-state', () => 'Git could not report its changes')
    .exhaustive()
}

/** The folder name, which is what a person recognises a worktree by. */
export function worktreeFolderName(path: string) {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.at(-1) ?? path
}

/** The row's title: the Session working in it, else its folder. */
export function worktreeTitle(entry: WorktreeInventoryEntry) {
  const [first, ...rest] = entry.sessions
  if (!first) return worktreeFolderName(entry.path)
  return rest.length === 0
    ? first.title
    : `${first.title} + ${plural(rest.length, 'other', 'others')}`
}

/** Case-insensitive match on the path, the branch and the titles of the Sessions using it. */
export function worktreeEntryMatchesSearch(entry: WorktreeInventoryEntry, search: string) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [
    entry.path,
    entry.branch ?? 'detached',
    ...entry.sessions.map((session) => session.title),
  ].some((value) => value.toLowerCase().includes(needle))
}

/**
 * The space some worktrees take, as copy: "about X" once every one is measured, "at least X"
 * while some are not, and null before any is, so no figure is claimed that was not measured.
 */
export function approximateSpace(
  paths: readonly string[],
  space: ReadonlyMap<string, number | null | undefined>,
) {
  const sizes = paths.map((path) => space.get(path))
  const measured = sizes.filter((bytes) => typeof bytes === 'number')
  if (measured.length === 0) return null
  const total = formatBytes(measured.reduce((sum, bytes) => sum + bytes, 0))
  return measured.length === sizes.length ? `about ${total}` : `at least ${total}`
}
