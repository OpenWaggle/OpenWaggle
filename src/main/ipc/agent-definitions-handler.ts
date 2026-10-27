import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import { browserWindowFromWebContents, showOpenDialog } from '../desktop-ui'
import {
  forgetAgentDefinitionImportSources,
  listAgentDefinitionImportSources,
  rememberAgentDefinitionImportSource,
} from './agent-definition-ipc-authority'
import { hostHandle, typedHandle } from './typed-ipc'

export function registerAgentDefinitionsHandlers() {
  hostHandle('agent-definitions:list-display')
  hostHandle('agent-definitions:get-preview')
  hostHandle('agent-definitions:set-enabled')
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
  hostHandle('agent-definitions:manage', {
    prepareRemoteArgs: (event, command) => [
      {
        command,
        selectedSourcePaths: listAgentDefinitionImportSources(event.sender.id),
      },
    ],
  })
}
