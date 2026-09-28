import { useId } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useActionDiscovery, useNativeActions } from '../../hooks/useNativeActions'
import { usePanelDraft } from '../../hooks/usePanelDraft'
import {
  type ActionDraft,
  type ActionPanelDraft,
  draftDescription,
  editActionDraft,
  newActionDraft,
  proposalActionDraft,
} from '../../lib/action-panel-drafts'
import { type ActionPanelRequest, useActionPanelStore } from '../../state/action-panel-store'
import { ActionEditorForm } from './ActionEditorForm'
import { ActionPanelChrome } from './ActionPanelChrome'
import { DraftSwitchPrompt } from './PanelNotices'
import { requestForDraft } from './panel-requests'

type ActionRequest = Extract<ActionPanelRequest, { kind: 'action' }>

export function useOtherSessionProject(projectPath: string) {
  const { activeSession } = useChat()
  const other = activeSession?.projectPath
  return other && other !== projectPath ? other : null
}

/** Adds or edits a Project action, resuming this project's draft when there is one. */
export function ActionEditorPanel({ request }: { readonly request: ActionRequest }) {
  const titleId = useId()
  const catalog = useNativeActions(request.scope)
  const discovery = useActionDiscovery(request.scope)
  const closePanel = useActionPanelStore((state) => state.closePanel)
  const entry = request.actionId
    ? catalog.data?.actions.find(({ definition }) => definition.id === request.actionId)
    : undefined
  const { proposal } = request
  const state = usePanelDraft<ActionDraft>({
    projectPath: request.scope.projectPath,
    target: `action:${request.actionId ?? 'new'}`,
    matches: (draft): draft is ActionDraft =>
      draft.kind === 'action' && (!proposal || draft.proposalReason === proposal.reason),
    create: () => {
      if (!catalog.data || (request.actionId && !entry) || discovery.isPending) return null
      if (entry && proposal) return proposalActionDraft(entry, proposal)
      if (entry) return editActionDraft(entry)
      return newActionDraft((discovery.data?.tasks.length ?? 0) > 0)
    },
  })
  const otherSessionProject = useOtherSessionProject(request.scope.projectPath)
  const title = request.actionId ? 'Edit action' : 'New action'
  const chrome = {
    titleId,
    projectPath: request.scope.projectPath,
    otherSessionProject,
    onClose: closePanel,
  }
  if (state.status === 'switch')
    return (
      <ActionPanelChrome {...chrome} title={title} description={null}>
        <SwitchPrompt request={request} existing={state.existing} />
      </ActionPanelChrome>
    )
  if (state.status === 'loading' || !catalog.data)
    return (
      <ActionPanelChrome {...chrome} title={title} description={null}>
        <p role="status" className="text-sm text-text-tertiary">
          {catalog.data && request.actionId && !entry
            ? 'This action no longer exists. It may have been removed.'
            : 'Loading your actions…'}
        </p>
      </ActionPanelChrome>
    )
  return (
    <ActionEditorForm
      chrome={chrome}
      request={request}
      catalog={catalog.data}
      entry={entry}
      draft={state.draft}
      onChange={state.update}
      onDiscard={() => {
        state.discard()
        closePanel()
      }}
    />
  )
}

function SwitchPrompt(props: {
  readonly request: ActionRequest
  readonly existing: ActionPanelDraft
}) {
  const { openPanel, discardDraft } = useActionPanelStore.getState()
  return (
    <DraftSwitchPrompt
      unfinished={draftDescription(props.existing)}
      replaceLabel={
        props.request.proposal
          ? 'Replace it with the agent’s proposal'
          : 'Discard it and start this one'
      }
      onContinue={() =>
        openPanel(requestForDraft(props.existing, props.request.scope, props.request.origin))
      }
      onReplace={() => discardDraft(props.request.scope.projectPath)}
    />
  )
}
