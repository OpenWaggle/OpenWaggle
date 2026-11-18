import type { ScheduledTask } from '@shared/types/scheduled-task'
import type { ReactNode } from 'react'

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-text-secondary">{children}</dd>
    </>
  )
}

const FAILURE_TEXT = {
  wake: 'wakes the Run if it fails or times out',
  skip: 'skips the firing if it fails or times out',
} as const

/** A Heartbeat's way to finish, Wake check and idle Auto-pause, in its settings. */
export function HeartbeatSettingRows({ task }: { readonly task: ScheduledTask }) {
  const heartbeat = task.heartbeat
  if (!heartbeat) return null
  const { wakeCheck } = heartbeat
  return (
    <>
      <Row label="Stops when">
        {heartbeat.stopWhen ?? (heartbeat.indefinite ? 'Never: it runs indefinitely' : 'Not set')}
      </Row>
      <Row label="Wake check">
        {wakeCheck ? (
          <span className="space-y-0.5">
            <code className="block whitespace-pre-wrap break-all font-mono text-text-primary">
              {wakeCheck.command}
            </code>
            <span className="block text-text-tertiary">
              Runs first; {FAILURE_TEXT[wakeCheck.onFailure]}
              {wakeCheck.approval === 'pending' ? ' · waiting for your approval' : ''}
            </span>
          </span>
        ) : (
          'None: every firing starts a Run'
        )}
      </Row>
      <Row label="Idle runs">
        {String(heartbeat.consecutiveIdleRuns)} in a row · pauses itself after{' '}
        {String(heartbeat.idlePauseAfter)}
      </Row>
    </>
  )
}
