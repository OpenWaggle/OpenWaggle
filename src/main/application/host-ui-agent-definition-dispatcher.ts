import { match } from '@diegogbrisa/ts-match'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import {
  getAgentDefinitionPreviewOperation,
  listAgentDefinitionDisplayOperation,
  setAgentDefinitionEnabledOperation,
} from './agent-definition-display-operations'
import {
  decodeAgentDefinitionInput,
  manageHostUiAgentDefinitions,
} from './host-ui-agent-definition-operation'
import {
  invalidHostUiInput,
  requiredHostUiString,
  requireHostUiArgCount,
} from './host-ui-operation-validation'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3
const REMOTE_GUI_SENDER_ID = 0

export function isHostUiAgentDefinitionChannel(
  channel: HostBackedGuiChannel,
): channel is Extract<HostBackedGuiChannel, `agent-definitions:${string}`> {
  return channel.startsWith('agent-definitions:')
}

export function dispatchHostUiAgentDefinitionOperation(
  channel: Extract<HostBackedGuiChannel, `agent-definitions:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('agent-definitions:manage', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1)
        const input = decodeAgentDefinitionInput(args[0])
        if (!input) return yield* invalidHostUiInput('Agent definition source approval is invalid.')
        return yield* manageHostUiAgentDefinitions({
          senderId: REMOTE_GUI_SENDER_ID,
          command: input.command,
          ...(input.selectedSourcePaths ? { selectedSourcePaths: input.selectedSourcePaths } : {}),
        })
      }),
    )
    .with('agent-definitions:list-display', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1)
        return yield* listAgentDefinitionDisplayOperation(
          yield* requiredHostUiString(args[0], 'Project path'),
        )
      }),
    )
    .with('agent-definitions:get-preview', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const name = yield* requiredHostUiString(args[1], 'Agent name')
        return yield* getAgentDefinitionPreviewOperation(projectPath, name)
      }),
    )
    .with('agent-definitions:set-enabled', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, THREE_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const name = yield* requiredHostUiString(args[1], 'Agent name')
        if (typeof args[TWO_ARGUMENTS] !== 'boolean') {
          return yield* invalidHostUiInput('Agent enabled must be a boolean.')
        }
        return yield* setAgentDefinitionEnabledOperation(projectPath, name, args[TWO_ARGUMENTS])
      }),
    )
    .exhaustive()
}
