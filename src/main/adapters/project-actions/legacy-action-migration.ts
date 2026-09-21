import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { storedProjectActionsSchema } from '@shared/schemas/project-actions'
import type { ActionDefinition, PreparationDefinition } from '@shared/types/action-definitions'
import { projectActionShortcutRules } from '@shared/utils/project-action-shortcuts'
import {
  EMPTY_ACTION_MANIFEST,
  type LocalActionDocument,
  preparationExecutionKey,
} from '../../domain/project-action-catalog'
import { readActionConfigSource } from './action-manifest-file'

const legacySchema = Schema.Struct({ actions: Schema.optional(storedProjectActionsSchema) })

export async function migrateLegacyActionDocument(
  projectPath: string,
): Promise<LocalActionDocument> {
  const legacySource = await readActionConfigSource(projectPath, '.openwaggle/settings.json')
  const legacy =
    legacySource === null
      ? []
      : (decodeUnknownOrThrow(legacySchema, parseJsonUnknown(legacySource)).actions ?? [])
  const actions: ActionDefinition[] = legacy.map((action) => ({
    id: action.id,
    name: action.name,
    icon: action.icon,
    invocation: { type: 'command', command: action.command, directory: '.' },
    kind: 'task',
    allowConcurrent: false,
    autoOpenPreview: action.autoOpenPreview ?? false,
    ...(action.previewUrl ? { previewUrl: action.previewUrl } : {}),
    shortcutRules: projectActionShortcutRules(action),
  }))
  const preparation: PreparationDefinition[] = legacy
    .filter((action) => action.runOnWorktreeCreate)
    .map((action) => ({
      id: `setup-${action.id}`,
      profileId: 'default',
      phase: 'setup',
      invocation: { type: 'command', command: action.command, directory: '.' },
    }))
  return {
    manifest: { ...EMPTY_ACTION_MANIFEST, actions, preparation },
    reviews: preparation.map((definition) => ({
      definitionId: definition.id,
      fingerprint: preparationExecutionKey(definition),
      invocation: definition.invocation,
      enabled: true,
    })),
    migration: { version: 1, legacySource },
  }
}
