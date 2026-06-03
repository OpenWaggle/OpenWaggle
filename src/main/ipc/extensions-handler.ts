import { assertMatching, P } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  extensionAcceptUpdateInputSchema,
  extensionApproveBuildInputSchema,
  extensionListPackagesInputSchema,
  extensionReloadInputSchema,
  extensionSetEnabledInputSchema,
  extensionSetProjectDisabledInputSchema,
  extensionSetTrustedInputSchema,
} from '@shared/schemas/extensions'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApproveBuildInput,
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
  ExtensionListPackagesInput,
  ExtensionPackageLifecycleScope,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { listExtensionContributionRegistryView } from '../application/extension-contribution-registry-service'
import {
  acceptExtensionUpdate,
  approveExtensionBuild,
  reloadExtension,
  setExtensionEnabled,
  setExtensionProjectDisabled,
  setExtensionTrusted,
} from '../application/extension-lifecycle-service'
import { listExtensionPackagesView } from '../application/extension-manager-view-service'
import type { AppServices } from '../runtime'
import { validateProjectPath, validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export interface RegisterExtensionsHandlersDependencies {
  readonly listExtensionContributionsView?: (
    input: ExtensionListContributionsInput,
  ) => EffectType<ExtensionContributionRegistryView, unknown, AppServices>
}

function dedupeProjectPaths(projectPaths: readonly string[]) {
  const deduped: string[] = []
  for (const projectPath of projectPaths) {
    if (!deduped.includes(projectPath)) {
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
  if (!projectPaths) {
    return Effect.succeed([])
  }

  return Effect.forEach(projectPaths, (projectPath) =>
    validateProjectPath(projectPath).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
  ).pipe(
    Effect.map((validatedProjectPaths) =>
      dedupeProjectPaths(validatedProjectPaths.filter(presentString)),
    ),
  )
}

function decodeListPackagesInput(raw: unknown): Effect.Effect<ExtensionListPackagesInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) {
      return { projectPaths: [] }
    }

    const decoded = yield* decodeSchema(extensionListPackagesInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths }
  })
}

function validateListContributionsInputShape(raw: unknown): Effect.Effect<void, Error> {
  if (raw === undefined) {
    return Effect.void
  }

  return Effect.try({
    try: () => {
      assertMatching(
        P.exact({
          projectPaths: P.optional(P.array(P.string)),
        }),
        raw,
      )
    },
    catch: () =>
      new Error('Extension contribution list input must be an object with optional projectPaths.'),
  })
}

function decodeListContributionsInput(
  raw: unknown,
): Effect.Effect<ExtensionListContributionsInput, Error> {
  return Effect.gen(function* () {
    if (raw === undefined) {
      return { projectPaths: [] }
    }

    yield* validateListContributionsInputShape(raw)
    const decoded = yield* decodeSchema(extensionListPackagesInputSchema, raw)
    const projectPaths = yield* validateProjectPaths(decoded.projectPaths)
    return { projectPaths }
  })
}

function decodeSchema<A, I>(schema: Schema.Schema<A, I, never>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) {
    return Effect.fail(new Error(decoded.issues.join('; ')))
  }
  return Effect.succeed(decoded.data)
}

function validateLifecycleScope(
  scope: ExtensionPackageLifecycleScope,
): Effect.Effect<ExtensionPackageLifecycleScope, Error> {
  return Effect.gen(function* () {
    if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
      return scope
    }

    const projectPath = yield* validateProjectPath(scope.projectPath)
    if (!projectPath) {
      return yield* Effect.fail(new Error('Project extension scope requires a project path.'))
    }

    return {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      projectPath,
    }
  })
}

function normalizeTrustedInput(raw: unknown): Effect.Effect<ExtensionSetTrustedInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetTrustedInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      viewProjectPaths,
    }
  })
}

function normalizeEnabledInput(raw: unknown): Effect.Effect<ExtensionSetEnabledInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetEnabledInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      viewProjectPaths,
    }
  })
}

function normalizeProjectDisabledInput(
  raw: unknown,
): Effect.Effect<ExtensionSetProjectDisabledInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetProjectDisabledInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const projectPath = yield* validateRequiredProjectPath(decoded.projectPath)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      projectPath,
      viewProjectPaths,
    }
  })
}

function normalizeAcceptUpdateInput(
  raw: unknown,
): Effect.Effect<ExtensionAcceptUpdateInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionAcceptUpdateInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      viewProjectPaths,
    }
  })
}

function normalizeApproveBuildInput(
  raw: unknown,
): Effect.Effect<ExtensionApproveBuildInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionApproveBuildInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      viewProjectPaths,
    }
  })
}

function normalizeReloadInput(raw: unknown): Effect.Effect<ExtensionReloadInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionReloadInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPaths = yield* validateProjectPaths(decoded.viewProjectPaths)
    return {
      ...decoded,
      scope,
      viewProjectPaths,
    }
  })
}

export function registerExtensionsHandlers(
  dependencies: RegisterExtensionsHandlersDependencies = {},
): void {
  const listExtensionContributionsView =
    dependencies.listExtensionContributionsView ?? listExtensionContributionRegistryView

  typedHandle('extensions:list-packages', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListPackagesInput(input)
      return yield* listExtensionPackagesView(decoded)
    }),
  )

  typedHandle('extensions:list-contributions', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListContributionsInput(input)
      return yield* listExtensionContributionsView(decoded)
    }),
  )

  typedHandle('extensions:set-trusted', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeTrustedInput(input)
      return yield* setExtensionTrusted(normalizedInput)
    }),
  )

  typedHandle('extensions:set-enabled', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeEnabledInput(input)
      return yield* setExtensionEnabled(normalizedInput)
    }),
  )

  typedHandle('extensions:set-project-disabled', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeProjectDisabledInput(input)
      return yield* setExtensionProjectDisabled(normalizedInput)
    }),
  )

  typedHandle('extensions:accept-update', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeAcceptUpdateInput(input)
      return yield* acceptExtensionUpdate(normalizedInput)
    }),
  )

  typedHandle('extensions:approve-build', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeApproveBuildInput(input)
      return yield* approveExtensionBuild(normalizedInput)
    }),
  )

  typedHandle('extensions:reload', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeReloadInput(input)
      return yield* reloadExtension(normalizedInput)
    }),
  )
}
