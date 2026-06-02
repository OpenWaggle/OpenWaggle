import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  extensionSetEnabledInputSchema,
  extensionSetTrustedInputSchema,
} from '@shared/schemas/extensions'
import type {
  ExtensionPackageLifecycleScope,
  ExtensionSetEnabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import {
  setExtensionEnabled,
  setExtensionTrusted,
} from '../application/extension-lifecycle-service'
import { listExtensionPackagesView } from '../application/extension-manager-view-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

function decodeProjectPathArg(value: unknown) {
  if (typeof value === 'string' || value === null || value === undefined) {
    return Effect.succeed(value)
  }

  return Effect.fail(new Error('Project path must be a string, null, or undefined.'))
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
    const viewProjectPath = yield* validateProjectPath(decoded.viewProjectPath)
    return {
      ...decoded,
      scope,
      viewProjectPath: viewProjectPath ?? null,
    }
  })
}

function normalizeEnabledInput(raw: unknown): Effect.Effect<ExtensionSetEnabledInput, Error> {
  return Effect.gen(function* () {
    const decoded = yield* decodeSchema(extensionSetEnabledInputSchema, raw)
    const scope = yield* validateLifecycleScope(decoded.scope)
    const viewProjectPath = yield* validateProjectPath(decoded.viewProjectPath)
    return {
      ...decoded,
      scope,
      viewProjectPath: viewProjectPath ?? null,
    }
  })
}

export function registerExtensionsHandlers(): void {
  typedHandle('extensions:list-packages', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const decodedProjectPath = yield* decodeProjectPathArg(projectPath)
      const validatedProjectPath = yield* validateProjectPath(decodedProjectPath)
      return yield* listExtensionPackagesView(validatedProjectPath ?? null)
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
}
