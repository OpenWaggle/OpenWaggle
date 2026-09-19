import type { WorkingPath } from '@shared/types/brand'
import { GitPullRequest, RefreshCw, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ChangeRequestPanelContent } from './ChangeRequestPanelContent'
import {
  type ChangeRequestPanelController,
  useChangeRequestPanelController,
} from './use-change-request-panel-controller'

interface ChangeRequestPanelProps {
  readonly sessionId: string | null
  readonly workingPath: WorkingPath | null
  readonly requestUrl: string | null
  readonly open: boolean
  readonly onClose: () => void
  readonly onSelectRequest: (url: string) => void
  readonly onOpenDiff: () => void
}

function ChangeRequestPanelHeader({
  controller,
  onClose,
}: {
  readonly controller: ChangeRequestPanelController
  readonly onClose: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <GitPullRequest className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
        {controller.snapshot?.provider.id === 'gitlab' ? 'Merge request' : 'Pull request'}
      </h2>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh change request"
        disabled={!controller.bound}
        aria-disabled={!controller.bound || controller.query.isFetching}
        onClick={() => {
          if (controller.bound && !controller.query.isFetching) void controller.query.refetch()
        }}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close change request" onClick={onClose}>
        <X className="size-4" aria-hidden="true" />
      </Button>
    </header>
  )
}

function ChangeRequestPanelBody({
  controller,
  onSelectRequest,
  onOpenDiff,
}: {
  readonly controller: ChangeRequestPanelController
  readonly onSelectRequest: (url: string) => void
  readonly onOpenDiff: () => void
}) {
  if (!controller.bound) {
    return (
      <p className="p-4 text-sm text-text-tertiary">
        This request is not bound to the opened Session.
      </p>
    )
  }
  if (controller.query.isLoading) {
    return (
      <output aria-live="polite" className="p-4 text-sm text-text-tertiary">
        Loading request…
      </output>
    )
  }
  if (!controller.result?.ok) {
    return (
      <div className="p-4 text-sm">
        <p role="alert" className="text-error-text">
          {controller.result?.message ?? 'Could not load this request.'}
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void controller.query.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }
  return (
    <ChangeRequestPanelContent
      controller={controller}
      onSelectRequest={onSelectRequest}
      onOpenDiff={onOpenDiff}
    />
  )
}

function BoundChangeRequestPanel({
  sessionId,
  workingPath,
  requestUrl,
  open,
  onClose,
  onSelectRequest,
  onOpenDiff,
}: ChangeRequestPanelProps) {
  const controller = useChangeRequestPanelController({
    sessionId,
    workingPath,
    requestUrl,
    open,
  })
  return (
    <section className="flex size-full min-h-0 flex-col bg-diff-bg" aria-label="Change request">
      <ChangeRequestPanelHeader controller={controller} onClose={onClose} />
      <ChangeRequestPanelBody
        controller={controller}
        onSelectRequest={onSelectRequest}
        onOpenDiff={onOpenDiff}
      />
    </section>
  )
}

export function ChangeRequestPanel(props: ChangeRequestPanelProps) {
  const identity = JSON.stringify([props.sessionId, props.workingPath, props.requestUrl])
  return <BoundChangeRequestPanel key={identity} {...props} />
}
