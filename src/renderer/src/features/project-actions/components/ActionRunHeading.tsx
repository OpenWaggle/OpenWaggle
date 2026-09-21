import type { ActionRun } from '@shared/types/action-runs'
import { actionRunLabel, resolvedActionCommand } from '../lib/native-action-display'
export function ActionRunHeading({
  run,
  error,
}: {
  readonly run: ActionRun | null
  readonly error: string | null
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text-primary">
            {run?.action.name ?? 'Connecting to action…'}
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            {error ? 'Reconnecting…' : run ? actionRunLabel(run) : 'Loading retained output'}
          </p>
        </div>
        {run?.exitCode !== null && run?.exitCode !== undefined ? (
          <span className="text-xs text-text-tertiary">Exit {run.exitCode}</span>
        ) : null}
      </div>
      {run ? (
        <>
          <code className="block overflow-x-auto rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-primary">
            {resolvedActionCommand(run.invocation)}
          </code>
          <p className="break-all text-xs text-text-tertiary">{run.workspacePath}</p>
        </>
      ) : null}
    </>
  )
}
