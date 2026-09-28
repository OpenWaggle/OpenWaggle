import { match } from '@diegogbrisa/ts-match'
import { useRef } from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { proposalKey } from '../../lib/action-panel-drafts'
import { type ActionPanelRequest, useActionPanelStore } from '../../state/action-panel-store'
import { ActionEditorPanel } from './ActionEditorPanel'
import { PreparationEditorPanel } from './PreparationEditorPanel'
import { PreparationReviewPanel } from './PreparationReviewPanel'

function requestKey(request: ActionPanelRequest) {
  return match(request)
    .with(
      { kind: 'action' },
      (value) =>
        `action:${value.scope.projectPath}:${value.actionId ?? 'new'}:${value.proposal ? proposalKey(value.proposal) : ''}`,
    )
    .with(
      { kind: 'preparation' },
      (value) => `preparation:${value.scope.projectPath}:${value.profileId}:${value.phase}`,
    )
    .with(
      { kind: 'review' },
      (value) => `review:${value.projectPath}:${value.review.entry.definition.id}`,
    )
    .exhaustive()
}

/**
 * The guided action panel's content. Escape closes it and keeps anything unfinished, through the
 * app's Escape stack so an inner popover or confirmation is dismissed first.
 */
export function ActionPanel({ request }: { readonly request: ActionPanelRequest }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEscapeHotkey(() => useActionPanelStore.getState().closePanel(), {
    shouldHandle: () => rootRef.current?.contains(document.activeElement) ?? false,
  })
  return (
    <div ref={rootRef} className="flex size-full min-h-0 flex-col" data-testid="action-panel">
      {match(request)
        .with({ kind: 'action' }, (value) => (
          <ActionEditorPanel key={requestKey(value)} request={value} />
        ))
        .with({ kind: 'preparation' }, (value) => (
          <PreparationEditorPanel key={requestKey(value)} request={value} />
        ))
        .with({ kind: 'review' }, (value) => (
          <PreparationReviewPanel key={requestKey(value)} request={value} />
        ))
        .exhaustive()}
    </div>
  )
}
