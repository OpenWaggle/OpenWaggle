import type { SessionId, SupportedModelId } from '@shared/types/brand'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'

/**
 * The commands the Session's Pi extensions register, which the slash menu lists. With no Session,
 * as in a New session draft, those of the project a Session would start in.
 */
export function extensionCommandsQueryOptions(
  sessionId: SessionId | null,
  model: SupportedModelId | null,
  projectPath: string | null = null,
) {
  return queryOptions({
    queryKey: queryKeys.extensionCommands(sessionId, model, sessionId ? null : projectPath),
    enabled: model !== null && (sessionId !== null || projectPath !== null),
    queryFn: () => {
      if (!model) throw new Error('A model lists the commands.')
      if (sessionId) return api.listExtensionCommands(sessionId, model)
      if (!projectPath) throw new Error('A Session or a project lists the commands.')
      return api.listExtensionCommands(null, model, projectPath)
    },
  })
}
