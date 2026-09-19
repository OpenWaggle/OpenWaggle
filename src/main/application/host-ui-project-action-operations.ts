import { match } from '@diegogbrisa/ts-match'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import {
  projectActionIdSchema,
  projectActionInputSchema,
  projectActionUpdateSchema,
} from '@shared/schemas/project-actions'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs, IpcInvokeReturn } from '@shared/types/ipc'
import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import * as Effect from 'effect/Effect'
import {
  addProjectAction,
  deleteProjectAction,
  discoverT3ProjectActions,
  importT3ProjectAction,
  listProjectActions,
  updateProjectAction,
} from '../config/project-actions'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { requireHostUiArgCount } from './host-ui-operation-validation'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3
const projectPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(PROJECT_ACTION_LIMITS.PROJECT_PATH_LENGTH),
)

const sourceIndexSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT - 1),
)

function validatedProjectPath(rawProjectPath: unknown) {
  const decoded = safeDecodeUnknown(projectPathSchema, rawProjectPath)
  if (!decoded.success) {
    return Effect.fail(new Error(`Invalid project path: ${decoded.issues.join('; ')}`))
  }
  return validateRequiredProjectPath(decoded.data)
}

function serializedByteLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validatePayloadBudget(value: unknown) {
  if (serializedByteLength(value) <= PROJECT_ACTION_LIMITS.IPC_PAYLOAD_BYTES) {
    return Effect.void
  }
  return Effect.fail(new Error('Project action payload exceeds the supported size.'))
}

function validateActionId(actionId: unknown) {
  const decoded = safeDecodeUnknown(projectActionIdSchema, actionId)
  if (!decoded.success) {
    return Effect.fail(new Error(`Invalid project action id: ${decoded.issues.join('; ')}`))
  }
  return Effect.succeed(decoded.data)
}

function validateActionInput(input: unknown) {
  const decoded = safeDecodeUnknown(projectActionInputSchema, input)
  if (!decoded.success) {
    return Effect.fail(new Error(`Invalid project action: ${decoded.issues.join('; ')}`))
  }
  return Effect.succeed(decoded.data)
}

function validateActionUpdate(update: unknown) {
  const decoded = safeDecodeUnknown(projectActionUpdateSchema, update)
  if (!decoded.success) {
    return Effect.fail(new Error(`Invalid project action update: ${decoded.issues.join('; ')}`))
  }
  return Effect.succeed(decoded.data)
}

function validateSourceIndex(sourceIndex: unknown) {
  const decoded = safeDecodeUnknown(sourceIndexSchema, sourceIndex)
  if (!decoded.success) {
    return Effect.fail(new Error(`Invalid t3.json action index: ${decoded.issues.join('; ')}`))
  }
  return Effect.succeed(decoded.data)
}

export type HostUiProjectActionChannel = Extract<HostBackedGuiChannel, `project-actions:${string}`>

export function isHostUiProjectActionChannel(
  channel: HostBackedGuiChannel,
): channel is HostUiProjectActionChannel {
  return channel.startsWith('project-actions:')
}

function executeProjectAction(channel: HostUiProjectActionChannel, args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireHostUiArgCount(
      args,
      match(channel)
        .with('project-actions:list', 'project-actions:discover-t3', () => 1)
        .with(
          'project-actions:add',
          'project-actions:delete',
          'project-actions:import-t3',
          () => TWO_ARGUMENTS,
        )
        .with('project-actions:update', () => THREE_ARGUMENTS)
        .exhaustive(),
    )
    const projectPath = yield* validatedProjectPath(args[0])
    return yield* match(channel)
      .with('project-actions:list', () => Effect.promise(() => listProjectActions(projectPath)))
      .with('project-actions:discover-t3', () =>
        Effect.promise(() => discoverT3ProjectActions(projectPath)),
      )
      .with('project-actions:add', () =>
        Effect.gen(function* () {
          yield* validatePayloadBudget(args[1])
          const input = yield* validateActionInput(args[1])
          return yield* Effect.promise(() => addProjectAction(projectPath, input))
        }),
      )
      .with('project-actions:update', () =>
        Effect.gen(function* () {
          const actionId = yield* validateActionId(args[1])
          yield* validatePayloadBudget(args[TWO_ARGUMENTS])
          const update = yield* validateActionUpdate(args[TWO_ARGUMENTS])
          return yield* Effect.promise(() => updateProjectAction(projectPath, actionId, update))
        }),
      )
      .with('project-actions:delete', () =>
        Effect.gen(function* () {
          const actionId = yield* validateActionId(args[1])
          return yield* Effect.promise(() => deleteProjectAction(projectPath, actionId))
        }),
      )
      .with('project-actions:import-t3', () =>
        Effect.gen(function* () {
          const sourceIndex = yield* validateSourceIndex(args[1])
          return yield* Effect.promise(() => importT3ProjectAction(projectPath, sourceIndex))
        }),
      )
      .exhaustive()
  })
}

export function dispatchHostUiProjectActionOperation<C extends HostUiProjectActionChannel>(
  channel: C,
  args: IpcInvokeArgs<C>,
): Effect.Effect<IpcInvokeReturn<C>, Error>
export function dispatchHostUiProjectActionOperation(
  channel: HostUiProjectActionChannel,
  args: readonly unknown[],
): Effect.Effect<unknown, Error>
export function dispatchHostUiProjectActionOperation(
  channel: HostUiProjectActionChannel,
  args: readonly unknown[],
) {
  return executeProjectAction(channel, args)
}
