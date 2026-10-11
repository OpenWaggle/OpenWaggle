import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentExtensionCommand } from '@shared/types/extension-command'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionCommands = readonly AgentExtensionCommand[]

/** The commands the Session's Pi extensions register, which the slash menu lists. */
export function extensionCommandsQueryOptions(
  sessionId: SessionId | null,
  model: SupportedModelId | null,
): OpenWaggleQueryOptions<
  ExtensionCommands,
  Error,
  ExtensionCommands,
  ReturnType<typeof queryKeys.extensionCommands>
> {
  return queryOptions({
    queryKey: queryKeys.extensionCommands(sessionId, model),
    enabled: sessionId !== null && model !== null,
    queryFn: () => {
      if (!sessionId || !model) throw new Error('A Session and its model list its commands.')
      return api.listExtensionCommands(sessionId, model)
    },
  })
}
