import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import {
  decodeUnknownExactOrThrow,
  getParseIssues,
  type Schema,
  safeDecodeUnknown,
} from '@shared/schema'
import {
  extensionAcceptUpdateInputSchema,
  extensionApplyPackageRemoveInputSchema,
  extensionApplyPackageWriteInputSchema,
  extensionApproveBuildInputSchema,
  extensionListContributionsInputSchema,
  extensionListPackagesInputSchema,
  extensionProposePackageRemoveInputSchema,
  extensionProposePackageWriteInputSchema,
  extensionReloadInputSchema,
  extensionSetEnabledInputSchema,
  extensionSetProjectDisabledInputSchema,
  extensionSetTrustedInputSchema,
} from '@shared/schemas/extensions'
import type {
  ExtensionApplyPackageWriteInput,
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

function validateProjectPaths(projectPaths: readonly string[] | undefined) {
  if (!projectPaths) {
    const effect: Effect.Effect<readonly string[], Error> = Effect.succeed([])
    return effect
  }

  const effect: Effect.Effect<readonly string[], Error> = Effect.forEach(
    projectPaths,
    (projectPath) =>
      validateProjectPath(projectPath).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
  ).pipe(
    Effect.map((validatedProjectPaths) =>
      dedupeProjectPaths(validatedProjectPaths.filter(presentString)),
    ),
  )
  return effect
}

function decodeSchema<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) return Effect.fail(new Error(decoded.issues.join('; ')))
  return Effect.succeed(decoded.data)
}

export function decodeHostUiExtensionListPackagesInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionListPackagesInput, Error> = Effect.gen(function* () {
    if (raw === undefined) return { projectPaths: [] }
    const decoded = yield* decodeSchema(extensionListPackagesInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths }
  })
  return effect
}

const LIST_CONTRIBUTIONS_INPUT_MESSAGE =
  'Extension contribution list input must be an object with optional projectPaths and sessionId'

/** Refuses undeclared keys too, naming the field that failed. */
function decodeListContributionsInput(raw: unknown) {
  return Effect.try({
    try: () => decodeUnknownExactOrThrow(extensionListContributionsInputSchema, raw),
    catch: (error) =>
      new Error(
        `${LIST_CONTRIBUTIONS_INPUT_MESSAGE}: ${(getParseIssues(error) ?? [String(error)]).join('; ')}`,
      ),
  })
}

function normalizeOptionalSessionId(sessionId: string | undefined) {
  const trimmed = sessionId?.trim()
  return trimmed ? { sessionId: trimmed } : {}
}

export function decodeHostUiExtensionListContributionsInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionListContributionsInput, Error> = Effect.gen(function* () {
    if (raw === undefined) return { projectPaths: [] }
    const decoded = yield* decodeListContributionsInput(raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths, ...normalizeOptionalSessionId(decoded.sessionId) }
  })
  return effect
}

function validateLifecycleScope(scope: ExtensionPackageLifecycleScope) {
  const effect: Effect.Effect<ExtensionPackageLifecycleScope, Error> = Effect.gen(function* () {
    if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) return scope
    const projectPath = yield* validateProjectPath(scope.projectPath)
    if (!projectPath) {
      return yield* Effect.fail(new Error('Project extension scope requires a project path.'))
    }
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath }
  })
  return effect
}

function normalizeLifecycleTargetInput<
  TInput extends {
    readonly scope: ExtensionPackageLifecycleScope
    readonly viewProjectPaths?: readonly string[]
  },
>(input: TInput) {
  return Effect.gen(function* () {
    const { viewProjectPaths: requestedViewProjectPaths, ...target } = input
    const scope = yield* validateLifecycleScope(input.scope)
    const viewProjectPaths = yield* validateProjectPaths(requestedViewProjectPaths)
    return { ...target, scope, viewProjectPaths }
  })
}

export function normalizeHostUiExtensionTrustedInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionSetTrustedInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetTrustedInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionProposePackageWriteInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionProposePackageWriteInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionProposePackageWriteInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionApplyPackageWriteInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionApplyPackageWriteInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApplyPackageWriteInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionProposePackageRemoveInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionProposePackageRemoveInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionProposePackageRemoveInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionApplyPackageRemoveInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionApplyPackageRemoveInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApplyPackageRemoveInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionEnabledInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionSetEnabledInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetEnabledInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionProjectDisabledInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionSetProjectDisabledInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetProjectDisabledInputSchema, raw)
    const normalized = yield* normalizeLifecycleTargetInput(decoded)
    const projectPath = yield* validateRequiredProjectPath(decoded.projectPath)
    return { ...normalized, projectPath }
  })
  return effect
}

export function normalizeHostUiExtensionAcceptUpdateInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionAcceptUpdateInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionAcceptUpdateInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionApproveBuildInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionApproveBuildInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApproveBuildInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}

export function normalizeHostUiExtensionReloadInput(raw: unknown) {
  const effect: Effect.Effect<ExtensionReloadInput, Error> = Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionReloadInputSchema, raw)
    return yield* normalizeLifecycleTargetInput(decoded)
  })
  return effect
}
