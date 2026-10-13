import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentExtensionCommand } from '@shared/types/extension-command'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionCommands = readonly AgentExtensionCommand[]

/**
 * The commands the Session's Pi extensions register, which the slash menu lists. With no Session,
 * as in a New session draft, those of the project a Session would start in.
 */
export function extensionCommandsQueryOptions(
  sessionId: SessionId | null,
  model: SupportedModelId | null,
  projectPath: string | null = null,
): OpenWaggleQueryOptions<
  ExtensionCommands,
  Error,
  ExtensionCommands,
  ReturnType<typeof queryKeys.extensionCommands>
> {
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
