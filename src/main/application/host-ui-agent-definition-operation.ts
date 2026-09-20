import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { loadAgentDefinitionSemanticCatalog } from '../agent-definition-semantic-catalog-loader'
import { resolveAgentDefinition } from '../agents/agent-definition-catalog'
import { executeAgentDefinitionManagement } from '../agents/agent-definition-management'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { authorizeAgentDefinitionUiCommand } from './agent-definition-ui-authority'

export interface HostUiAgentDefinitionOperationDependencies {
  readonly authorize?: typeof authorizeAgentDefinitionUiCommand
  readonly execute?: typeof executeAgentDefinitionManagement
  readonly resolve?: typeof resolveAgentDefinition
}

export function decodeAgentDefinitionInput(value: unknown) {
  if (!isRecord(value) || !Object.hasOwn(value, 'command')) {
    return { command: value, selectedSourcePaths: undefined }
  }
  if (
    !Array.isArray(value.selectedSourcePaths) ||
    !value.selectedSourcePaths.every((sourcePath) => typeof sourcePath === 'string')
  ) {
    return null
  }
  return { command: value.command, selectedSourcePaths: value.selectedSourcePaths }
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
    const repository = yield* SessionRepository
    const settings = yield* (yield* SettingsService).get()
    const authorized = yield* Effect.promise(() =>
      authorize({
        senderId: input.senderId,
        command: input.command,
        ...(input.selectedSourcePaths ? { selectedSourcePaths: input.selectedSourcePaths } : {}),
        knownProjectPaths: [
          ...(settings.projectPath ? [settings.projectPath] : []),
          ...settings.recentProjects,
        ].filter((projectPath): projectPath is string => typeof projectPath === 'string'),
        isKnownProjectPath: (requestedPath, canonicalPath) =>
          Effect.runPromise(repository.hasActiveProjectPath([requestedPath, canonicalPath])),
        resolveRefreshSourcePath: async (projectPath, name, scope) => {
          const definition = await resolve({ projectPath, name, ...(scope ? { scope } : {}) })
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
