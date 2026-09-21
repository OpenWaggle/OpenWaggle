import type { ActionManagementScope } from '@shared/types/action-management'
import { isActiveActionRun } from '@shared/types/action-runs'
import { useEffect, useRef } from 'react'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useActionOutput } from '../hooks/useActionOutput'
import { ActionRunControls } from './ActionRunControls'
import { ActionRunHeading } from './ActionRunHeading'

const OUTPUT_FOLLOW_THRESHOLD = 48

export function ActionRunPanel({
  scope,
  runId,
}: {
  readonly scope: ActionManagementScope
  readonly runId: string
}) {
  const state = useActionOutput(scope, runId)
  const run = state.run
  const active = run ? isActiveActionRun(run) : false
  const outputRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    if (state.output && follow.current && outputRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [state.output])
  return (
    <section aria-label="Action output" className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="space-y-3 border-b border-border p-4">
        <ActionRunHeading run={run} error={state.error} />
        {run ? <ActionRunControls scope={scope} run={run} output={state.output} /> : null}
        {run?.error ? (
          <p role="alert" className="text-xs text-error-text">
            {run.error}
          </p>
        ) : null}
        {state.error ? (
          <p role="status" className="text-xs text-text-tertiary">
            Retained output is still available. {state.error}
          </p>
        ) : null}
      </header>
      {state.truncated ? (
        <p className="border-b border-border px-4 py-2 text-xs text-text-tertiary">
          Earlier output was truncated.
        </p>
      ) : null}
      <div
        ref={outputRef}
        className="min-h-0 flex-1 overflow-auto p-3"
        onScroll={(event) => {
          const element = event.currentTarget
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            OUTPUT_FOLLOW_THRESHOLD
        }}
      >
        <PlainTextBlock reason="terminal" ariaLabel="Process output">
          {state.output || (active ? 'Waiting for output…' : 'No output retained.')}
        </PlainTextBlock>
      </div>
    </section>
  )
}
