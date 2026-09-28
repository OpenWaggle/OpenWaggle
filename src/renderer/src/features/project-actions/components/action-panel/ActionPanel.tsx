import { match } from '@diegogbrisa/ts-match'
import { useEffect, useRef, useState } from 'react'
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
 * app's Escape stack. It is enabled only while focus is inside the docked panel, so Escape keeps
 * working for every other surface (an enabled entry that declined would block the stack).
 */
export function ActionPanel({ request }: { readonly request: ActionPanelRequest }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [focusWithin, setFocusWithin] = useState(false)
  useEscapeHotkey(() => useActionPanelStore.getState().closePanel(), { enabled: focusWithin })
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const focusIn = () => setFocusWithin(true)
    const focusOut = (event: FocusEvent) =>
      setFocusWithin(event.relatedTarget instanceof Node && root.contains(event.relatedTarget))
    root.addEventListener('focusin', focusIn)
    root.addEventListener('focusout', focusOut)
    return () => {
      root.removeEventListener('focusin', focusIn)
      root.removeEventListener('focusout', focusOut)
    }
  }, [])
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
