import { safeDecodeUnknown } from '@shared/schema'
import { actionRelativePathSchema } from '@shared/schemas/action-definitions'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import { createRendererLogger } from '@/shared/lib/logger'
import type { DraftActionDefinition, DraftPreparationDefinition } from './action-panel-drafts'

const FALLBACK = 'Some details need a look before this can be saved.'
const logger = createRendererLogger('action-panel')

/** An unexpected validation failure keeps a plain message for the user and the detail in logs. */
function fallback(issues: readonly string[]) {
  logger.warn('An action draft failed validation for an unlisted reason', { issues })
  return FALLBACK
}

function invocationProblem(invocation: DraftActionDefinition['invocation']) {
  if (invocation.type !== 'command') return null
  if (!invocation.command.trim()) return 'Type the command it should run.'
  if (invocation.command.length > ACTION_DEFINITION_LIMITS.COMMAND_LENGTH)
    return `The command is too long. Keep it under ${String(ACTION_DEFINITION_LIMITS.COMMAND_LENGTH)} characters.`
  if (!safeDecodeUnknown(actionRelativePathSchema, invocation.directory).success)
    return 'The folder must be inside the project, such as . or packages/app.'
  return null
}

/** What stops a draft from saving, in plain words rather than schema issue text (ADR 0038). */
export function actionDraftProblem(definition: DraftActionDefinition, issues: readonly string[]) {
  if (!definition.name.trim()) return 'Give the action a name.'
  if (definition.name.trim().length > ACTION_DEFINITION_LIMITS.NAME_LENGTH)
    return `That name is too long. Keep it under ${String(ACTION_DEFINITION_LIMITS.NAME_LENGTH)} characters.`
  const invocation = invocationProblem(definition.invocation)
  if (invocation) return invocation
  const previewUrl = definition.previewUrl?.trim()
  if (previewUrl && normalizeBrowserPreviewAddress(previewUrl) === null)
    return 'The preview URL isn’t a web address, such as http://localhost:5173.'
  return fallback(issues)
}

export function preparationDraftProblem(
  definition: DraftPreparationDefinition,
  issues: readonly string[],
) {
  return invocationProblem(definition.invocation) ?? fallback(issues)
}
