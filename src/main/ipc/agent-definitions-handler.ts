import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import { loadAgentDefinitionSemanticCatalog } from '../agent-definition-semantic-catalog-loader'
import { resolveAgentDefinition } from '../agents/agent-definition-catalog'
import { executeAgentDefinitionManagement } from '../agents/agent-definition-management'
import { browserWindowFromWebContents, showOpenDialog } from '../desktop-ui'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import {
  authorizeAgentDefinitionIpcCommand,
  forgetAgentDefinitionImportSources,
  rememberAgentDefinitionImportSource,
} from './agent-definition-ipc-authority'
import { typedHandle } from './typed-ipc'

export function registerAgentDefinitionsHandlers() {
  typedHandle('agent-definitions:select-source', (event) =>
    Effect.gen(function* () {
      const owner = browserWindowFromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: 'Import Agent definition',
        properties: ['openFile'],
        filters: [
          { name: 'Agent definitions', extensions: ['md', 'markdown', 'toml'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const result = yield* Effect.promise(() => showOpenDialog(owner, options))
      const sourcePath = result.canceled ? null : (result.filePaths[0] ?? null)
      if (!sourcePath) return null
      const selected = yield* Effect.promise(() =>
        rememberAgentDefinitionImportSource(event.sender.id, sourcePath),
      )
      event.sender.once('destroyed', () => forgetAgentDefinitionImportSources(event.sender.id))
      return selected
    }),
  )
  typedHandle('agent-definitions:manage', (event, command) =>
    Effect.gen(function* () {
      const sessions = yield* (yield* SessionProjectionRepository).list()
      const settings = yield* (yield* SettingsService).get()
      const authorized = yield* Effect.promise(() =>
        authorizeAgentDefinitionIpcCommand({
          senderId: event.sender.id,
          command,
          knownProjectPaths: [
            ...(settings.projectPath ? [settings.projectPath] : []),
            ...settings.recentProjects,
            ...sessions.map((session) => session.projectPath),
          ].filter((projectPath): projectPath is string => typeof projectPath === 'string'),
          resolveRefreshSourcePath: async (projectPath, name) => {
            const definition = await resolveAgentDefinition({ projectPath, name })
            return definition.import?.sourcePath
          },
        }),
      )
      return yield* Effect.promise(() =>
        executeAgentDefinitionManagement(authorized, {
          loadSemanticCatalog: loadAgentDefinitionSemanticCatalog,
        }),
      )
    }),
  )
}
