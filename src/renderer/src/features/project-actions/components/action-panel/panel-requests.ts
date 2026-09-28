import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionPanelDraft } from '../../lib/action-panel-drafts'
import type { ActionPanelOrigin, ActionPanelRequest } from '../../state/action-panel-store'

/** The request that reopens the panel on an unfinished draft ("Continue …"). */
export function requestForDraft(
  draft: ActionPanelDraft,
  scope: ActionManagementScope,
  origin: ActionPanelOrigin,
): ActionPanelRequest {
  if (draft.kind === 'action') return { kind: 'action', scope, actionId: draft.actionId, origin }
  return {
    kind: 'preparation',
    scope,
    phase: draft.definition.phase,
    profileId: draft.definition.profileId,
    origin,
  }
}
