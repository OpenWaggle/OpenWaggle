import { Schema, safeDecodeUnknown } from '@shared/schema'
import {
  projectActionIdSchema,
  projectActionInputSchema,
  projectActionUpdateSchema,
} from '@shared/schemas/project-actions'
import {
  PROJECT_ACTION_LIMITS,
  type ProjectActionInput,
  type ProjectActionUpdate,
} from '@shared/types/project-actions'
import * as Effect from 'effect/Effect'
import {
  addProjectAction,
  deleteProjectAction,
  discoverT3ProjectActions,
  importT3ProjectAction,
  listProjectActions,
  updateProjectAction,
} from '../config/project-actions'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

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

export function registerProjectActionHandlers(): void {
  typedHandle('project-actions:list', (_event, projectPath) =>
    Effect.gen(function* () {
      const canonicalProjectPath = yield* validatedProjectPath(projectPath)
      return yield* Effect.promise(() => listProjectActions(canonicalProjectPath))
    }),
  )

  typedHandle('project-actions:add', (_event, projectPath, input: ProjectActionInput) =>
    Effect.gen(function* () {
      const canonicalProjectPath = yield* validatedProjectPath(projectPath)
      yield* validatePayloadBudget(input)
      const validatedInput = yield* validateActionInput(input)
      return yield* Effect.promise(() => addProjectAction(canonicalProjectPath, validatedInput))
    }),
  )

  typedHandle(
    'project-actions:update',
    (_event, projectPath, actionId, update: ProjectActionUpdate) =>
      Effect.gen(function* () {
        const canonicalProjectPath = yield* validatedProjectPath(projectPath)
        const validatedActionId = yield* validateActionId(actionId)
        yield* validatePayloadBudget(update)
        const validatedUpdate = yield* validateActionUpdate(update)
        return yield* Effect.promise(() =>
          updateProjectAction(canonicalProjectPath, validatedActionId, validatedUpdate),
        )
      }),
  )

  typedHandle('project-actions:delete', (_event, projectPath, actionId) =>
    Effect.gen(function* () {
      const canonicalProjectPath = yield* validatedProjectPath(projectPath)
      const validatedActionId = yield* validateActionId(actionId)
      return yield* Effect.promise(() =>
        deleteProjectAction(canonicalProjectPath, validatedActionId),
      )
    }),
  )

  typedHandle('project-actions:discover-t3', (_event, projectPath) =>
    Effect.gen(function* () {
      const canonicalProjectPath = yield* validatedProjectPath(projectPath)
      return yield* Effect.promise(() => discoverT3ProjectActions(canonicalProjectPath))
    }),
  )

  typedHandle('project-actions:import-t3', (_event, projectPath, sourceIndex) =>
    Effect.gen(function* () {
      const canonicalProjectPath = yield* validatedProjectPath(projectPath)
      const validatedSourceIndex = yield* validateSourceIndex(sourceIndex)
      return yield* Effect.promise(() =>
        importT3ProjectAction(canonicalProjectPath, validatedSourceIndex),
      )
    }),
  )
}
