import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { listAgentDefinitions, previewAgentDefinition } from '../agents/agent-definition-catalog'
import { agentDefinitionTogglesForProject } from '../agents/agent-definition-toggle-settings'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { authorizeAgentDefinitionUiCommand } from './agent-definition-ui-authority'

const agentNameSchema = Schema.String.pipe(Schema.minLength(1))

function authorizedProject(rawProjectPath: string) {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const repository = yield* SessionRepository
    const command = yield* Effect.promise(() =>
      authorizeAgentDefinitionUiCommand({
        senderId: 0,
        command: { operation: 'list', projectPath: rawProjectPath },
        knownProjectPaths: [
          ...(settings.projectPath ? [settings.projectPath] : []),
          ...settings.recentProjects,
        ].filter((projectPath): projectPath is string => typeof projectPath === 'string'),
        isKnownProjectPath: (requestedPath, canonicalPath) =>
          Effect.runPromise(repository.hasActiveProjectPath([requestedPath, canonicalPath])),
      }),
    )
    return command.projectPath
  })
}

export function listAgentDefinitionDisplayOperation(rawProjectPath: string) {
  return Effect.gen(function* () {
    const projectPath = yield* authorizedProject(rawProjectPath)
    const settings = yield* (yield* SettingsService).get()
    const toggles = yield* Effect.promise(() =>
      agentDefinitionTogglesForProject(settings.agentDefinitionTogglesByProject, projectPath),
    )
    const items = yield* Effect.promise(() => listAgentDefinitions({ projectPath }))
    return items.map((item) => ({
      name: item.name,
      description: item.description,
      scope: item.scope,
      sourcePath: item.sourcePath,
      ...(item.contentDigest ? { contentDigest: item.contentDigest } : {}),
      ...(item.loadError ? { loadError: item.loadError } : {}),
      enabled: toggles[item.name] !== false,
    }))
  })
}

export function getAgentDefinitionPreviewOperation(rawProjectPath: string, rawName: string) {
  return Effect.gen(function* () {
    const projectPath = yield* authorizedProject(rawProjectPath)
    const name = decodeUnknownOrThrow(agentNameSchema, rawName)
    const markdown = yield* Effect.promise(() => previewAgentDefinition({ projectPath, name }))
    return { markdown }
  })
}

export function setAgentDefinitionEnabledOperation(
  rawProjectPath: string,
  rawName: string,
  enabled: boolean,
) {
  return Effect.gen(function* () {
    const projectPath = yield* authorizedProject(rawProjectPath)
    const name = decodeUnknownOrThrow(agentNameSchema, rawName)
    const items = yield* Effect.promise(() => listAgentDefinitions({ projectPath }))
    if (!items.some((item) => item.name === name)) {
      return yield* Effect.fail(
        new Error(`Agent definition ${JSON.stringify(name)} was not found.`),
      )
    }
    const service = yield* SettingsService
    if (service.setAgentDefinitionEnabled) {
      return yield* service.setAgentDefinitionEnabled(projectPath, name, enabled)
    }
    const settings = yield* service.get()
    const next = {
      ...settings.agentDefinitionTogglesByProject,
      [projectPath]: {
        ...(settings.agentDefinitionTogglesByProject[projectPath] ?? {}),
        [name]: enabled,
      },
    }
    yield* service.update({ agentDefinitionTogglesByProject: next })
  })
}
