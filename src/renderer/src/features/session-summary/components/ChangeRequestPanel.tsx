import type { WorkingPath } from '@shared/types/brand'
import { GitPullRequest, RefreshCw, X } from 'lucide-react'
import { useFocusHandoff } from '@/shared/hooks/useFocusHandoff'
import { Button } from '@/shared/ui/Button'
import { RightPanelMaximizeButton } from '@/shared/ui/RightPanelMaximizeButton'
import { providerSiteLabel } from '../model/change-request-attention'
import { ChangeRequestPanelContent, ChangeRequestWebsiteButton } from './ChangeRequestPanelContent'
import { SourceControlAttentionNotice } from './SourceControlAttentionNotice'

/** The request title, else the first remaining action (a still-failing load's Retry). */
const REQUEST_TITLE_SELECTOR = 'h3[tabindex="-1"], button'

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
      <RightPanelMaximizeButton />
      <Button variant="ghost" size="icon-sm" aria-label="Close change request" onClick={onClose}>
        <X className="size-4" aria-hidden="true" />
      </Button>
    </header>
  )
}

function ChangeRequestPanelFailure({
  controller,
}: {
  readonly controller: ChangeRequestPanelController
}) {
  const result = controller.result
  const attention = result && !result.ok ? result.attention : undefined
  const refetch = () => void controller.query.refetch()
  if (attention) {
    return (
      <div className="p-4">
        <SourceControlAttentionNotice
          label="Change request inspector setup"
          attention={attention}
          terminal={controller.terminal}
          websiteUrl={controller.requestUrl}
          onRecheck={controller.recheckSourceControl}
        />
      </div>
    )
  }
  return (
    <div className="space-y-3 p-4 text-sm">
      <p role="alert" className="text-error-text">
        {result?.ok === false ? result.message : 'Could not load this request.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={refetch}>
          Retry
        </Button>
        {controller.requestUrl ? (
          <ChangeRequestWebsiteButton
            ownerKey={controller.ownerKey}
            url={controller.requestUrl}
            label={providerSiteLabel(null, controller.requestUrl)}
          />
        ) : null}
      </div>
    </div>
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
    return <ChangeRequestPanelFailure controller={controller} />
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
  // A source-control fix replaces the focused notice with the request itself.
  const bodyFocus = useFocusHandoff<HTMLDivElement>({ target: REQUEST_TITLE_SELECTOR })
  return (
    <section className="flex size-full min-h-0 flex-col bg-diff-bg" aria-label="Change request">
      <ChangeRequestPanelHeader controller={controller} onClose={onClose} />
      <div ref={bodyFocus} className="flex min-h-0 flex-1 flex-col">
        <ChangeRequestPanelBody
          controller={controller}
          onSelectRequest={onSelectRequest}
          onOpenDiff={onOpenDiff}
        />
      </div>
    </section>
  )
}

export function ChangeRequestPanel(props: ChangeRequestPanelProps) {
  const identity = JSON.stringify([props.sessionId, props.workingPath, props.requestUrl])
  return <BoundChangeRequestPanel key={identity} {...props} />
}
