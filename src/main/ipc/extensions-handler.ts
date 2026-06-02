import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  extensionAcceptUpdateInputSchema,
  extensionApproveBuildInputSchema,
  extensionListPackagesInputSchema,
  extensionSetEnabledInputSchema,
  extensionSetProjectDisabledInputSchema,
  extensionSetTrustedInputSchema,
} from '@shared/schemas/extensions'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApproveBuildInput,
  ExtensionListPackagesInput,
  ExtensionPackageLifecycleScope,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import {
  acceptExtensionUpdate,
  approveExtensionBuild,
  setExtensionEnabled,
  setExtensionProjectDisabled,
  setExtensionTrusted,
} from '../application/extension-lifecycle-service'
import { listExtensionPackagesView } from '../application/extension-manager-view-service'
import { validateProjectPath, validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

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

export function registerExtensionsHandlers(): void {
  typedHandle('extensions:list-packages', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListPackagesInput(input)
      return yield* listExtensionPackagesView(decoded)
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
}
