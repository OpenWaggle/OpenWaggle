import type { VcsChangeRequestDetails } from '@shared/types/git'
import { ExternalLink, GitMerge } from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { useUIStore } from '@/shell/ui-store'
import {
  ChangeRequestChangedFiles,
  ChangeRequestChecks,
  ChangeRequestDetailSummary,
  requestMetric,
} from './ChangeRequestPanelDetails'
import type { ChangeRequestPanelController } from './use-change-request-panel-controller'

const HEAD_COMMIT_DISPLAY_LENGTH = 12

function RequestSelection({
  controller,
  onSelectRequest,
}: {
  readonly controller: ChangeRequestPanelController
  readonly onSelectRequest: (url: string) => void
}) {
  if (!controller.selected || controller.requests.length <= 1) return null
  return (
    <label className="mb-3 block text-xs text-text-tertiary" htmlFor="change-request-selection">
      Open requests
      <Select
        id="change-request-selection"
        selectSize="xs"
        className="mt-1 block w-full"
        value={controller.selected.url}
        onChange={(event) => onSelectRequest(event.target.value)}
      >
        {controller.requests.map((request) => (
          <option key={request.url} value={request.url}>
            {request.title}
          </option>
        ))}
      </Select>
    </label>
  )
}

function RequestIdentity({ details }: { readonly details: VcsChangeRequestDetails }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <h3 className="text-sm font-semibold leading-snug text-text-primary">{details.title}</h3>
      <p className="mt-1 truncate font-mono text-xs text-text-tertiary">
        #{details.reference} ·{' '}
        {details.headCommit?.slice(0, HEAD_COMMIT_DISPLAY_LENGTH) ?? 'head unavailable'}
      </p>
      <p className="mt-1 truncate text-xs text-text-tertiary" title={details.url}>
        {details.url}
      </p>
    </div>
  )
}

function MergeControls({ controller }: { readonly controller: ChangeRequestPanelController }) {
  const selected = controller.selected
  const showToast = useUIStore((state) => state.showToast)
  if (!selected) return null
  const mergeStatus = controller.merging ? 'Merging…' : (controller.mergeMessage ?? '')
  return (
    <section className="space-y-2 px-4 py-3" aria-label="Request activity and actions">
      <p className="text-xs text-text-tertiary">
        {requestMetric(selected.commentsCount)} comments · {requestMetric(selected.reviewsCount)}{' '}
        reviews
        {selected.reviewThreadsCount === null
          ? ''
          : ` · ${requestMetric(selected.unresolvedReviewThreadsCount)} unresolved threads`}
      </p>
      <Button
        fullWidth
        variant="secondary"
        onClick={() => {
          void api.openExternal(selected.url).catch((cause: unknown) => {
            showToast(
              cause instanceof Error ? cause.message : 'Could not open this request.',
              'error',
            )
          })
        }}
        leftIcon={<ExternalLink className="size-3.5" aria-hidden="true" />}
      >
        Open in browser
      </Button>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="change-request-merge-method">
          Merge method
        </label>
        <Select
          id="change-request-merge-method"
          selectSize="xs"
          className="min-w-0 flex-1"
          value={controller.effectiveMethod}
          disabled={!controller.mergeAllowed}
          aria-disabled={!controller.mergeAllowed || controller.merging}
          onChange={(event) => {
            if (controller.merging) return
            const next = selected.merge.methods.find(
              (candidate) => candidate === event.target.value,
            )
            if (next) controller.setMethod(next)
          }}
        >
          {selected.merge.methods.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button
          variant="primary"
          disabled={!controller.mergeAllowed}
          aria-disabled={!controller.mergeAllowed || controller.merging}
          title={controller.mergeDisabledReason ?? undefined}
          onClick={() => {
            if (controller.mergeAllowed && !controller.merging) controller.merge()
          }}
          leftIcon={<GitMerge className="size-3.5" aria-hidden="true" />}
        >
          {controller.merging ? 'Merging…' : 'Merge'}
        </Button>
      </div>
      {!controller.mergeAllowed && controller.mergeDisabledReason ? (
        <p className="text-xs text-text-tertiary">{controller.mergeDisabledReason}</p>
      ) : null}
      <output
        aria-live="polite"
        aria-atomic="true"
        className={mergeStatus ? 'block text-xs text-text-secondary' : 'sr-only'}
      >
        {mergeStatus}
      </output>
    </section>
  )
}

export function ChangeRequestPanelContent({
  controller,
  onSelectRequest,
  onOpenDiff,
}: {
  readonly controller: ChangeRequestPanelController
  readonly onSelectRequest: (url: string) => void
  readonly onOpenDiff: () => void
}) {
  const selected = controller.selected
  if (!selected) return null
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-3">
        <RequestSelection controller={controller} onSelectRequest={onSelectRequest} />
      </div>
      <RequestIdentity details={selected} />
      <ChangeRequestDetailSummary details={selected} />
      <ChangeRequestChangedFiles
        details={selected}
        currentRef={controller.snapshot?.currentRef ?? null}
        onOpenDiff={onOpenDiff}
      />
      <ChangeRequestChecks details={selected} />
      <MergeControls controller={controller} />
    </div>
  )
}
