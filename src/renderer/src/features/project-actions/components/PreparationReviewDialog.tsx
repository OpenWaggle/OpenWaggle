import type { ActionCatalog, ActionInvocation } from '@shared/types/action-definitions'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { actionInvocationLabel } from '../lib/native-action-display'

export function PreparationReviewDialog(props: {
  readonly entry: ActionCatalog['preparation'][number]
  readonly busy: boolean
  readonly error?: string | null
  readonly onDecide: (enabled: boolean) => void
  readonly onClose: () => void
}) {
  const title = useId()
  return (
    <ModalDialog
      labelledBy={title}
      onClose={props.onClose}
      dismissible={!props.busy}
      className="max-w-xl p-5"
    >
      <h2 id={title} className="text-base font-semibold">
        Review workspace {props.entry.definition.phase}
      </h2>
      <p className="mt-2 text-sm leading-6 text-text-tertiary">
        Enable this execution only after reviewing it. Your choice stays on this machine. Closing
        this dialog leaves it disabled.
      </p>
      <div className="my-5 grid gap-4">
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Previously reviewed</h3>
          {props.entry.previous ? (
            <InvocationReview invocation={props.entry.previous.invocation} />
          ) : (
            <p className="text-xs text-text-tertiary">No previous review</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Execution to enable</h3>
          <InvocationReview invocation={props.entry.definition.invocation} />
        </div>
      </div>
      {props.error ? (
        <p role="alert" className="mb-3 text-sm text-error-text">
          {props.error}
        </p>
      ) : null}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button disabled={props.busy} onClick={props.onClose}>
          Cancel
        </Button>
        <Button disabled={props.busy} onClick={() => props.onDecide(false)}>
          Keep disabled
        </Button>
        <Button variant="primary" disabled={props.busy} onClick={() => props.onDecide(true)}>
          Enable this version
        </Button>
      </footer>
    </ModalDialog>
  )
}

function InvocationReview({ invocation }: { readonly invocation: ActionInvocation }) {
  const directory = invocation.type === 'command' ? invocation.directory : invocation.task.directory
  return (
    <div className="space-y-2">
      <SyntaxBlock language="shellscript" wrap source={actionInvocationLabel(invocation)} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-secondary">
        <dt>Working directory</dt>
        <dd className="break-all">{directory === '.' ? 'Workspace root' : directory}</dd>
        {invocation.type === 'task' ? (
          <>
            <dt>Task provider</dt>
            <dd>{invocation.task.provider}</dd>
            {invocation.task.environment ? (
              <>
                <dt>Environment</dt>
                <dd>{invocation.task.environment}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
    </div>
  )
}
