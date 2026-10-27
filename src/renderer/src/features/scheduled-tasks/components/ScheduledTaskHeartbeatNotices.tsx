import type { ScheduledTask } from '@shared/types/scheduled-task'
import { CirclePause, Infinity as InfinityIcon, ShieldQuestion } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useApproveWakeCheck, useSetScheduledTaskEnabled } from '../hooks/useScheduledTaskMutations'
import { formatAbsoluteTime, heartbeatHasNoEnd, WAKE_CHECK_APPROVAL_TEXT } from '../lib/task-format'

function Notice({
  icon,
  label,
  children,
  action,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly children: ReactNode
  readonly action?: ReactNode
}) {
  return (
    <section
      aria-label={label}
      className="flex items-start gap-2 rounded-md border border-info/40 bg-info/5 px-2.5 py-2 text-xs text-text-primary"
    >
      <span aria-hidden="true" className="mt-px shrink-0 text-info-text">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  )
}

/** Who set a held command, by the kind of caller that created the task. */
function setBy(task: ScheduledTask) {
  if (task.creator.kind === 'profile') return `the “${task.creator.label}” access profile`
  if (task.creator.kind === 'session-agent') return 'an agent'
  return 'someone other than you'
}

/** A Heartbeat the Host held until the user approves its exact Wake check command. */
function WakeCheckApprovalNotice({ task }: { readonly task: ScheduledTask }) {
  const approve = useApproveWakeCheck()
  const wakeCheck = task.heartbeat?.wakeCheck
  if (wakeCheck?.approval !== 'pending') return null
  return (
    <Notice
      icon={<ShieldQuestion className="size-3.5" />}
      label="Wake check approval"
      action={
        <Button
          variant="primary"
          size="xs"
          disabled={approve.isPending}
          onClick={() => approve.mutate({ taskId: task.id, command: wakeCheck.command })}
        >
          Approve
        </Button>
      }
    >
      <p className="font-medium">{WAKE_CHECK_APPROVAL_TEXT}</p>
      <p className="text-text-secondary">
        Its Session asks for approval, and {setBy(task)} set this command. Before each firing the
        Session Host runs it in the Session’s workspace, with your access:
      </p>
      <PlainTextBlock reason="terminal" className="break-all py-1 text-text-primary">
        {wakeCheck.command}
      </PlainTextBlock>
      {approve.error ? (
        <p role="alert" className="text-error-text">
          {approve.error.message}
        </p>
      ) : null}
    </Notice>
  )
}

/** A Heartbeat the Host paused by itself: done, or too many idle runs in a row. */
function AutoPauseNotice({ task }: { readonly task: ScheduledTask }) {
  const enabled = useSetScheduledTaskEnabled()
  const autoPause = task.heartbeat?.autoPause
  if (!autoPause || task.enabled) return null
  return (
    <Notice
      icon={<CirclePause className="size-3.5" />}
      label="Auto-paused"
      action={
        <Button
          variant="secondary"
          size="xs"
          disabled={enabled.pendingTaskId === task.id}
          onClick={() => enabled.setEnabled(task.id, true)}
        >
          Resume
        </Button>
      }
    >
      <p>
        <span className="font-medium">{autoPause.message}</span>
        <span className="text-text-tertiary"> · {formatAbsoluteTime(autoPause.since)}</span>
      </p>
      <p className="text-text-secondary">
        {autoPause.reason === 'done'
          ? 'Its Run reported that its work is done.'
          : 'Its last runs found nothing to do, so it stopped spending tokens.'}{' '}
        Resume it to keep watching.
      </p>
    </Notice>
  )
}

/** A grandfathered or explicitly open-ended Heartbeat says that it never finishes. */
function NoEndNotice({ task }: { readonly task: ScheduledTask }) {
  if (!heartbeatHasNoEnd(task)) return null
  return (
    <Notice icon={<InfinityIcon className="size-3.5" />} label="No end">
      <p>
        <span className="font-medium">This Heartbeat has no end.</span>{' '}
        <span className="text-text-secondary">
          It runs until you pause it. Edit it to add a Stop condition, an end date, or a run limit.
        </span>
      </p>
    </Notice>
  )
}

export function ScheduledTaskHeartbeatNotices({ task }: { readonly task: ScheduledTask }) {
  if (!task.heartbeat) return null
  return (
    <>
      <WakeCheckApprovalNotice task={task} />
      <AutoPauseNotice task={task} />
      <NoEndNotice task={task} />
    </>
  )
}
