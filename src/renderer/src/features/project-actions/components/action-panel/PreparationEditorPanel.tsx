import type { ActionCatalog } from '@shared/types/action-definitions'
import { useId } from 'react'
import { useActionDiscovery, useNativeActions } from '../../hooks/useNativeActions'
import { useOtherSessionProject } from '../../hooks/useOtherSessionProject'
import { usePanelDraft } from '../../hooks/usePanelDraft'
import { PREPARATION_COPY } from '../../lib/action-panel-copy'
import {
  draftDescription,
  editPreparationDraft,
  newPreparationDraft,
  type PreparationDraft,
} from '../../lib/action-panel-drafts'
import { type ActionPanelRequest, useActionPanelStore } from '../../state/action-panel-store'
import { ActionPanelChrome } from './ActionPanelChrome'
import { DraftSwitchPrompt } from './PanelNotices'
import { PreparationEditorForm } from './PreparationEditorForm'
import { requestForDraft } from './panel-requests'

/** Profiles are named only once a project has more than one (ADR 0038). */
const PROFILES_WORTH_NAMING = 2

type PreparationRequest = Extract<ActionPanelRequest, { kind: 'preparation' }>

function preparationTitle(request: PreparationRequest, catalog: ActionCatalog | undefined) {
  const base = PREPARATION_COPY[request.phase].title
  const profiles = catalog?.profiles ?? []
  if (profiles.length < PROFILES_WORTH_NAMING) return base
  const profile = profiles.find(({ definition }) => definition.id === request.profileId)
  return profile ? `${base} · ${profile.definition.name} profile` : base
}

export function PreparationEditorPanel({ request }: { readonly request: PreparationRequest }) {
  const titleId = useId()
  const catalog = useNativeActions(request.scope)
  const discovery = useActionDiscovery(request.scope)
  const closePanel = useActionPanelStore((state) => state.closePanel)
  const entry = catalog.data?.preparation.find(
    ({ definition }) =>
      definition.profileId === request.profileId && definition.phase === request.phase,
  )
  const state = usePanelDraft<PreparationDraft>({
    projectPath: request.scope.projectPath,
    target: `preparation:${request.profileId}:${request.phase}`,
    matches: (draft): draft is PreparationDraft => draft.kind === 'preparation',
    ready: Boolean(catalog.data) && !discovery.isPending,
    create: () => {
      return entry
        ? editPreparationDraft(entry)
        : newPreparationDraft(
            request.phase,
            request.profileId,
            (discovery.data?.tasks.length ?? 0) > 0,
          )
    },
  })
  const otherSessionProject = useOtherSessionProject(request.scope.projectPath)
  const chrome = {
    titleId,
    title: preparationTitle(request, catalog.data),
    projectPath: request.scope.projectPath,
    otherSessionProject,
    onClose: closePanel,
  }
  if (state.status === 'switch')
    return (
      <ActionPanelChrome {...chrome} description={null}>
        <DraftSwitchPrompt
          unfinished={draftDescription(state.existing)}
          replaceLabel="Discard it and start this one"
          onContinue={() =>
            useActionPanelStore
              .getState()
              .openPanel(requestForDraft(state.existing, request.scope, request.origin))
          }
          onReplace={() => useActionPanelStore.getState().discardDraft(request.scope.projectPath)}
        />
      </ActionPanelChrome>
    )
  if (state.status === 'loading' || !catalog.data)
    return (
      <ActionPanelChrome {...chrome} description={null}>
        <p role="status" className="text-sm text-text-tertiary">
          Loading your setup…
        </p>
      </ActionPanelChrome>
    )
  return (
    <PreparationEditorForm
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
