import { match } from '@diegogbrisa/ts-match'
import type { KeyboardEvent } from 'react'
import { type ActionPanelRequest, useActionPanelStore } from '../../state/action-panel-store'
import { ActionEditorPanel } from './ActionEditorPanel'
import { PreparationEditorPanel } from './PreparationEditorPanel'
import { PreparationReviewPanel } from './PreparationReviewPanel'

function requestKey(request: ActionPanelRequest) {
  return match(request)
    .with(
      { kind: 'action' },
      (value) =>
        `action:${value.scope.projectPath}:${value.actionId ?? 'new'}:${value.proposal?.reason ?? ''}`,
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

/** The guided action panel's content; Escape closes it and keeps anything unfinished. */
export function ActionPanel({ request }: { readonly request: ActionPanelRequest }) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    useActionPanelStore.getState().closePanel()
  }
  return (
    <section
      aria-label="Action panel"
      className="flex size-full min-h-0 flex-col"
      data-testid="action-panel"
      onKeyDown={handleKeyDown}
    >
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
    </section>
  )
}
