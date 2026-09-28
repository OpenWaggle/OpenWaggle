import { safeDecodeUnknown } from '@shared/schema'
import { actionRelativePathSchema } from '@shared/schemas/action-definitions'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import type { DraftActionDefinition, DraftPreparationDefinition } from './action-panel-drafts'

const FALLBACK = 'Some details need a look before this can be saved.'

function invocationProblem(invocation: DraftActionDefinition['invocation']) {
  if (invocation.type !== 'command') return null
  if (!invocation.command.trim()) return 'Type the command it should run.'
  if (!safeDecodeUnknown(actionRelativePathSchema, invocation.directory).success)
    return 'The folder must be inside the project, such as . or packages/app.'
  return null
}

/** What stops a draft from saving, in plain words rather than schema issue text (ADR 0038). */
export function actionDraftProblem(definition: DraftActionDefinition) {
  if (!definition.name.trim()) return 'Give the action a name.'
  const invocation = invocationProblem(definition.invocation)
  if (invocation) return invocation
  const previewUrl = definition.previewUrl?.trim()
  if (previewUrl && normalizeBrowserPreviewAddress(previewUrl) === null)
    return 'The preview URL isn’t a web address, such as http://localhost:5173.'
  return FALLBACK
}

export function preparationDraftProblem(definition: DraftPreparationDefinition) {
  return invocationProblem(definition.invocation) ?? FALLBACK
}
