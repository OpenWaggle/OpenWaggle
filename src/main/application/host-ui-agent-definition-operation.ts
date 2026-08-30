import * as Effect from 'effect/Effect'
import { loadAgentDefinitionSemanticCatalog } from '../agent-definition-semantic-catalog-loader'
import { resolveAgentDefinition } from '../agents/agent-definition-catalog'
import { executeAgentDefinitionManagement } from '../agents/agent-definition-management'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { authorizeAgentDefinitionUiCommand } from './agent-definition-ui-authority'

export interface HostUiAgentDefinitionOperationDependencies {
  readonly authorize?: typeof authorizeAgentDefinitionUiCommand
  readonly execute?: typeof executeAgentDefinitionManagement
  readonly resolve?: typeof resolveAgentDefinition
}

export function manageHostUiAgentDefinitions(
  input: {
    readonly senderId: number
    readonly command: unknown
    readonly selectedSourcePaths?: readonly string[]
  },
  dependencies: HostUiAgentDefinitionOperationDependencies = {},
) {
  const authorize = dependencies.authorize ?? authorizeAgentDefinitionUiCommand
  const execute = dependencies.execute ?? executeAgentDefinitionManagement
  const resolve = dependencies.resolve ?? resolveAgentDefinition
  return Effect.gen(function* () {
    const sessions = yield* (yield* SessionProjectionRepository).list()
    const settings = yield* (yield* SettingsService).get()
    const authorized = yield* Effect.promise(() =>
      authorize({
        senderId: input.senderId,
        command: input.command,
        ...(input.selectedSourcePaths ? { selectedSourcePaths: input.selectedSourcePaths } : {}),
        knownProjectPaths: [
          ...(settings.projectPath ? [settings.projectPath] : []),
          ...settings.recentProjects,
          ...sessions.map((session) => session.projectPath),
        ].filter((projectPath): projectPath is string => typeof projectPath === 'string'),
        resolveRefreshSourcePath: async (projectPath, name) => {
          const definition = await resolve({ projectPath, name })
          return definition.import?.sourcePath
        },
      }),
    )
    return yield* Effect.promise(() =>
      execute(authorized, {
        loadSemanticCatalog: loadAgentDefinitionSemanticCatalog,
      }),
    )
  })
}
