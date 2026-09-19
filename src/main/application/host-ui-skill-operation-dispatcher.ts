import { match } from '@diegogbrisa/ts-match'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import {
  invalidHostUiInput,
  requiredHostUiString,
  requireHostUiArgCount,
} from './host-ui-operation-validation'
import {
  getSkillPreviewOperation,
  listSkillsOperation,
  setSkillEnabledOperation,
} from './skill-operations'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3

export function dispatchHostUiSkillsOperation(
  channel: Extract<HostBackedGuiChannel, `skills:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('skills:list', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        return yield* listSkillsOperation(projectPath)
      }),
    )
    .with('skills:set-enabled', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, THREE_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const skillId = yield* requiredHostUiString(args[1], 'Skill ID')
        if (typeof args[TWO_ARGUMENTS] !== 'boolean') {
          return yield* invalidHostUiInput('Skill enabled must be a boolean.')
        }
        return yield* setSkillEnabledOperation(projectPath, skillId, args[TWO_ARGUMENTS])
      }),
    )
    .with('skills:get-preview', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const skillId = yield* requiredHostUiString(args[1], 'Skill ID')
        return yield* getSkillPreviewOperation(projectPath, skillId)
      }),
    )
    .exhaustive()
}
