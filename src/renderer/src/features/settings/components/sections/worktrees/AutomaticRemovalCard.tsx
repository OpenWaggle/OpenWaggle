import {
  AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS,
  type AutomaticWorktreeRemovalRun,
  type AutomaticWorktreeRemovalSettings,
  isAutomaticWorktreeRemovalDays,
  type WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import { decideAutomaticWorktreeRemoval } from '@shared/utils/automatic-worktree-removal'
import { useId } from 'react'
import { formatBytes, formatRelativeTime, projectName } from '@/shared/lib/format'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { useAutomaticWorktreeRemovalLog, type WorktreeSpaceByPath } from './use-worktree-inventory'
import { worktreeFolderName } from './worktree-inventory-format'

function plural(count: number, one: string, many: string) {
  return `${String(count)} ${count === 1 ? one : many}`
}

/** What turning the rule on, or the current rule, would remove right now. */
function previewLine(
  rule: AutomaticWorktreeRemovalSettings,
  entries: readonly WorktreeInventoryEntry[],
  space: WorktreeSpaceByPath,
  now: number,
) {
  // The rule as it would act if it were on, so the preview helps decide whether to turn it on.
  const candidate = { ...rule, enabled: true }
  const decisions = entries.map((entry) => ({
    entry,
    kind: decideAutomaticWorktreeRemoval(entry, candidate, now).kind,
  }))
  const due = decisions.filter((decision) => decision.kind === 'due').map(({ entry }) => entry)
  const kept = decisions.filter((decision) => decision.kind === 'kept').length
  const bytes = due.reduce((total, entry) => total + (space.get(entry.path) ?? 0), 0)
  const verb = rule.enabled ? 'Will remove' : 'Would remove'
  const removes =
    due.length === 0
      ? `${verb} nothing now.`
      : `${verb} ${plural(due.length, 'worktree', 'worktrees')} (about ${formatBytes(bytes)}) now.`
  return kept > 0 ? `${removes} ${plural(kept, 'is', 'are')} kept to protect work.` : removes
}

function runSummary(run: AutomaticWorktreeRemovalRun) {
  const freed = run.removed.reduce((total, removed) => total + (removed.reclaimableBytes ?? 0), 0)
  const removed =
    run.removed.length === 0
      ? 'removed nothing'
      : `removed ${plural(run.removed.length, 'worktree', 'worktrees')} (about ${formatBytes(freed)})`
  const failed = run.failed.length > 0 ? `, ${String(run.failed.length)} failed` : ''
  return `Last run ${formatRelativeTime(run.finishedAt)} · ${removed}${failed}`
}

function LastRun({ run }: { readonly run: AutomaticWorktreeRemovalRun }) {
  if (run.removed.length === 0 && run.failed.length === 0) {
    return <p className="text-xs text-text-tertiary">{runSummary(run)}</p>
  }
  return (
    <details className="text-xs text-text-tertiary">
      <summary className="cursor-pointer">{runSummary(run)}</summary>
      <ul className="mt-2 space-y-1 pl-4">
        {run.removed.map((removed) => (
          <li key={removed.path}>
            {removed.sessionTitles.join(', ') || worktreeFolderName(removed.path)} ·{' '}
            {projectName(removed.projectPath)} · branch {removed.branch ?? 'detached'} kept
          </li>
        ))}
        {run.failed.map((failed) => (
          <li key={failed.path} className="text-error-text">
            {worktreeFolderName(failed.path)}: {failed.message}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Automatic worktree removal: one app-wide opt-in rule, what it would do, and what it did. */
export function AutomaticRemovalCard(props: {
  readonly rule: AutomaticWorktreeRemovalSettings
  readonly onChange: (rule: AutomaticWorktreeRemovalSettings) => void
  /** Every worktree, in every project: the rule is app-wide. */
  readonly entries: readonly WorktreeInventoryEntry[]
  readonly space: WorktreeSpaceByPath
  readonly now: number
}) {
  const daysId = useId()
  const log = useAutomaticWorktreeRemovalLog()
  const lastRun = log.data?.runs[0]
  return (
    <section
      aria-label="Automatic cleanup"
      className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-primary">
            Remove worktrees of archived Sessions automatically
          </span>
          <span className="text-xs leading-5 text-text-tertiary">
            Archiving keeps a worktree, so restoring the Session is instant. With this on, a
            worktree is removed once every Session in it has been archived this long, in every
            project. Worktrees with uncommitted changes or commits that are not on a remote are
            kept. Branches are always kept.
          </span>
        </div>
        <ToggleSwitch
          label="Remove worktrees of archived Sessions automatically"
          checked={props.rule.enabled}
          onCheckedChange={(enabled) => props.onChange({ ...props.rule, enabled })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <label htmlFor={daysId}>After archiving for</label>
        <Select
          id={daysId}
          selectSize="xs"
          value={String(props.rule.archivedDays)}
          onChange={(event) => {
            const days = Number(event.target.value)
            if (isAutomaticWorktreeRemovalDays(days)) {
              props.onChange({ ...props.rule, archivedDays: days })
            }
          }}
        >
          {AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS.map((days) => (
            <option key={days} value={String(days)}>
              {String(days)} days
            </option>
          ))}
        </Select>
        <span className="text-text-tertiary" aria-live="polite">
          {previewLine(props.rule, props.entries, props.space, props.now)}
        </span>
      </div>
      {lastRun ? <LastRun run={lastRun} /> : null}
    </section>
  )
}
