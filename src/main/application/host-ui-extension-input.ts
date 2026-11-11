import { assertMatching, P } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  extensionAcceptUpdateInputSchema,
  extensionApplyPackageRemoveInputSchema,
  extensionApplyPackageWriteInputSchema,
  extensionApproveBuildInputSchema,
  extensionListContributionsInputSchema,
  extensionListPackagesInputSchema,
  type extensionPackageWorkflowActorSchema,
  extensionProposePackageRemoveInputSchema,
  extensionProposePackageWriteInputSchema,
  extensionReloadInputSchema,
  extensionSetEnabledInputSchema,
  extensionSetProjectDisabledInputSchema,
  extensionSetTrustedInputSchema,
} from '@shared/schemas/extensions'
import type {
  ExtensionApplyPackageWriteInput,
  ExtensionPackageWorkflowActor,
  ExtensionPackageWorkflowGlobalConfirmation,
  ExtensionProposePackageWriteInput,
} from '@shared/types/extension-package-workflow'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApplyPackageRemoveInput,
  ExtensionApproveBuildInput,
  ExtensionListContributionsInput,
  ExtensionListPackagesInput,
  ExtensionPackageLifecycleScope,
  ExtensionProposePackageRemoveInput,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { validateProjectPath, validateRequiredProjectPath } from '../utils/project-path-validation'

function dedupeProjectPaths(projectPaths: readonly string[]) {
  const deduped: string[] = []
  const seenProjectPaths = new Set<string>()
  for (const projectPath of projectPaths) {
    if (!seenProjectPaths.has(projectPath)) {
      seenProjectPaths.add(projectPath)
      deduped.push(projectPath)
    }
  }
  return deduped
}

function presentString(value: string | undefined): value is string {
  return value !== undefined
}

function validateProjectPaths(
  projectPaths: readonly string[] | undefined,
): Effect.Effect<readonly string[], Error> {
  if (!projectPaths) return Effect.succeed([])

  return Effect.forEach(projectPaths, (projectPath) =>
    validateProjectPath(projectPath).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
  ).pipe(
    Effect.map((validatedProjectPaths) =>
      dedupeProjectPaths(validatedProjectPaths.filter(presentString)),
    ),
  )
}

function decodeSchema<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) return Effect.fail(new Error(decoded.issues.join('; ')))
  return Effect.succeed(decoded.data)
}

export function decodeHostUiExtensionListPackagesInput(
  raw: unknown,
): Effect.Effect<ExtensionListPackagesInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) return { projectPaths: [] }
    const decoded = yield* decodeSchema(extensionListPackagesInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths }
  })
}

function validateListContributionsInputShape(raw: unknown): Effect.Effect<void, Error> {
  if (raw === undefined) return Effect.void
  return Effect.try({
    try: () => {
      assertMatching(
        P.exact({
          projectPaths: P.optional(P.array(P.string)),
          sessionId: P.optional(P.string),
        }),
        raw,
      )
    },
    catch: () =>
      new Error(
        'Extension contribution list input must be an object with optional projectPaths and sessionId.',
      ),
  })
}

function normalizeOptionalSessionId(sessionId: string | undefined) {
  const trimmed = sessionId?.trim()
  return trimmed ? { sessionId: trimmed } : {}
}

export function decodeHostUiExtensionListContributionsInput(
  raw: unknown,
): Effect.Effect<ExtensionListContributionsInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) return { projectPaths: [] }
    yield* validateListContributionsInputShape(raw)
    const decoded = yield* decodeSchema(extensionListContributionsInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths, ...normalizeOptionalSessionId(decoded.sessionId) }
  })
}

function validateLifecycleScope(
  scope: ExtensionPackageLifecycleScope,
): Effect.Effect<ExtensionPackageLifecycleScope, Error> {
  return Effect.gen(function* () {
    if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) return scope
    const projectPath = yield* validateProjectPath(scope.projectPath)
    if (!projectPath) {
      return yield* Effect.fail(new Error('Project extension scope requires a project path.'))
    }
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath }
  })
}

function normalizeLifecycleTargetInput<
  TInput extends {
    readonly scope: ExtensionPackageLifecycleScope
    readonly viewProjectPaths?: readonly string[] | undefined
  },
>(input: TInput) {
  return Effect.gen(function* () {
    const { viewProjectPaths: requestedViewProjectPaths, ...target } = input
    const scope = yield* validateLifecycleScope(input.scope)
    const viewProjectPaths = yield* validateProjectPaths(requestedViewProjectPaths)
    return { ...target, scope, viewProjectPaths }
  })
}

type DecodedWorkflowActor = Schema.Schema.Type<typeof extensionPackageWorkflowActorSchema>

/** The decoded actor with absent optional ids left absent instead of present and undefined. */
function exactWorkflowActor(actor: DecodedWorkflowActor): ExtensionPackageWorkflowActor {
  if (actor.kind === 'agent') {
    const { sessionId, ...agent } = actor
    return sessionId === undefined ? agent : { ...agent, sessionId }
  }
  if (actor.kind === 'user') {
    const { userId, ...user } = actor
    return userId === undefined ? user : { ...user, userId }
  }
  return actor
}

function withExactWorkflowActor<TInput extends { readonly actor: DecodedWorkflowActor }>(
  input: TInput,
) {
  return { ...input, actor: exactWorkflowActor(input.actor) }
}

/** Leaves an absent global confirmation absent instead of present and undefined. */
function omitAbsentGlobalConfirmation<
  TInput extends {
    readonly globalConfirmation?: ExtensionPackageWorkflowGlobalConfirmation | undefined
  },
>(input: TInput) {
  const { globalConfirmation, ...rest } = input
  return globalConfirmation === undefined ? rest : { ...rest, globalConfirmation }
}

export function normalizeHostUiExtensionTrustedInput(
  raw: unknown,
): Effect.Effect<ExtensionSetTrustedInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetTrustedInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
}

export function normalizeHostUiExtensionProposePackageWriteInput(
  raw: unknown,
): Effect.Effect<ExtensionProposePackageWriteInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionProposePackageWriteInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(withExactWorkflowActor(decoded))
  })
}

export function normalizeHostUiExtensionApplyPackageWriteInput(
  raw: unknown,
): Effect.Effect<ExtensionApplyPackageWriteInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApplyPackageWriteInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(
      withExactWorkflowActor(omitAbsentGlobalConfirmation(decoded)),
    )
  })
}

export function normalizeHostUiExtensionProposePackageRemoveInput(
  raw: unknown,
): Effect.Effect<ExtensionProposePackageRemoveInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionProposePackageRemoveInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(withExactWorkflowActor(decoded))
  })
}

export function normalizeHostUiExtensionApplyPackageRemoveInput(
  raw: unknown,
): Effect.Effect<ExtensionApplyPackageRemoveInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApplyPackageRemoveInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(
      withExactWorkflowActor(omitAbsentGlobalConfirmation(decoded)),
    )
  })
}

export function normalizeHostUiExtensionEnabledInput(
  raw: unknown,
): Effect.Effect<ExtensionSetEnabledInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetEnabledInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
}

export function normalizeHostUiExtensionProjectDisabledInput(
  raw: unknown,
): Effect.Effect<ExtensionSetProjectDisabledInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetProjectDisabledInputSchema, raw)
    const normalized = yield* normalizeLifecycleTargetInput(decoded)
    const projectPath = yield* validateRequiredProjectPath(decoded.projectPath)
    return { ...normalized, projectPath }
  })
}

export function normalizeHostUiExtensionAcceptUpdateInput(
  raw: unknown,
): Effect.Effect<ExtensionAcceptUpdateInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionAcceptUpdateInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
}

export function normalizeHostUiExtensionApproveBuildInput(
  raw: unknown,
): Effect.Effect<ExtensionApproveBuildInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApproveBuildInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
}

export function normalizeHostUiExtensionReloadInput(
  raw: unknown,
): Effect.Effect<ExtensionReloadInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionReloadInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
}
