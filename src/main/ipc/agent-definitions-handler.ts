import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import {
  getAgentDefinitionPreviewOperation,
  listAgentDefinitionDisplayOperation,
  setAgentDefinitionEnabledOperation,
} from '../application/agent-definition-display-operations'
import { manageHostUiAgentDefinitions } from '../application/host-ui-agent-definition-operation'
import { browserWindowFromWebContents, showOpenDialog } from '../desktop-ui'
import {
  forgetAgentDefinitionImportSources,
  listAgentDefinitionImportSources,
  rememberAgentDefinitionImportSource,
} from './agent-definition-ipc-authority'
import { hostHandle, typedHandle } from './typed-ipc'

export function registerAgentDefinitionsHandlers() {
  hostHandle('agent-definitions:list-display', (_event, projectPath) =>
    listAgentDefinitionDisplayOperation(projectPath),
  )
  hostHandle('agent-definitions:get-preview', (_event, projectPath, name) =>
    getAgentDefinitionPreviewOperation(projectPath, name),
  )
  hostHandle('agent-definitions:set-enabled', (_event, projectPath, name, enabled) =>
    setAgentDefinitionEnabledOperation(projectPath, name, enabled),
  )
  typedHandle('agent-definitions:select-source', (event) =>
    Effect.gen(function* () {
      const owner = browserWindowFromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: 'Select Agent definition source',
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
  hostHandle(
    'agent-definitions:manage',
    (event, command) => manageHostUiAgentDefinitions({ senderId: event.sender.id, command }),
    {
      prepareRemoteArgs: (event, command) => [
        {
          command,
          selectedSourcePaths: listAgentDefinitionImportSources(event.sender.id),
        },
      ],
    },
  )
}
