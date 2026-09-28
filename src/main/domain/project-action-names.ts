import type { ActionDefinition, ActionManifest } from '@shared/types/action-definitions'
import { actionNameKey } from '@shared/utils/action-name'
import { effective } from './effective-project-definitions'

interface PersonalActions {
  readonly manifest: Pick<ActionManifest, 'actions'>
}

/**
 * Project action names are unique per project (ADR 0038). Existing duplicates keep loading; only a
 * save that would create or keep a clash is rejected. A Local definition override shares its id.
 */
export function assertUniqueActionName(
  document: PersonalActions,
  shared: Pick<ActionManifest, 'actions'>,
  definition: ActionDefinition,
) {
  const key = actionNameKey(definition.name)
  const clash = effective(document.manifest.actions, shared.actions).find(
    (entry) =>
      entry.definition.id !== definition.id && actionNameKey(entry.definition.name) === key,
  )
  if (clash)
    throw new Error(
      `You already have an action called “${clash.definition.name}”. Choose a different name.`,
    )
}
