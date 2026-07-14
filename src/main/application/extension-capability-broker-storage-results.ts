import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionStorageDeletePayload,
  ExtensionStorageGetPayload,
  ExtensionStorageKind,
  ExtensionStorageListPayload,
  ExtensionStorageScope,
  ExtensionStorageScopeSelector,
  ExtensionStorageSetPayload,
} from '@shared/types/extension-broker'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { ExtensionPackageScope } from '../extensions/types'
import type {
  ExtensionStorageKey,
  ExtensionStorageKeyListInput,
} from '../ports/extension-storage-repository'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import { getScopeProjectPath } from './extension-capability-broker-model'
import {
  deleteExtensionStorageItem,
  getExtensionStorageItem,
  listExtensionStorageKeys,
  setExtensionStorageItem,
} from './extension-storage-service'

interface StorageRouteInput {
  readonly invocation: ExtensionInvokeInput
  readonly packageScope: ExtensionPackageScope
  readonly timestamp: number
}

function storageFailureMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Extension storage operation failed.'
}

function storageScopeFromSelector(
  selector: ExtensionStorageScopeSelector,
  invocation: ExtensionInvokeInput,
): ExtensionStorageScope | null {
  if (selector === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND }
  }

  const projectPath = getScopeProjectPath(invocation.scope)
  return projectPath ? { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND, projectPath } : null
}

function storageKey(input: {
  readonly invocation: ExtensionInvokeInput
  readonly packageScope: ExtensionPackageScope
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly key: string
}): ExtensionStorageKey {
  return {
    extensionId: input.invocation.extensionId,
    packageScope: input.packageScope,
    storageKind: input.storageKind,
    storageScope: input.storageScope,
    key: input.key,
  }
}

function storageKeyListInput(input: {
  readonly invocation: ExtensionInvokeInput
  readonly packageScope: ExtensionPackageScope
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
}): ExtensionStorageKeyListInput {
  return {
    extensionId: input.invocation.extensionId,
    packageScope: input.packageScope,
    storageKind: input.storageKind,
    storageScope: input.storageScope,
  }
}

function storageScopeFailure(input: StorageRouteInput) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
    message: 'Project-scoped extension storage requires a project, session, or branch scope.',
    timestamp: input.timestamp,
  })
}

function storageOperationFailure(input: {
  readonly invocation: ExtensionInvokeInput
  readonly timestamp: number
  readonly cause: unknown
}) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: storageFailureMessage(input.cause),
    timestamp: input.timestamp,
  })
}

function catchStorageFailure<R>(
  effect: EffectType<ExtensionInvokeResult, unknown, R>,
  input: StorageRouteInput,
) {
  return effect.pipe(
    Effect.catchAll((cause) =>
      storageOperationFailure({
        invocation: input.invocation,
        timestamp: input.timestamp,
        cause,
      }),
    ),
  )
}

function routeWithStorageScope<R>(
  input: StorageRouteInput,
  payload: { readonly storageScope: ExtensionStorageScopeSelector },
  operation: (storageScope: ExtensionStorageScope) => EffectType<ExtensionInvokeResult, unknown, R>,
) {
  const storageScope = storageScopeFromSelector(payload.storageScope, input.invocation)
  return storageScope
    ? catchStorageFailure(operation(storageScope), input)
    : storageScopeFailure(input)
}

export function routeStorageGet(
  input: StorageRouteInput & { readonly payload: ExtensionStorageGetPayload },
) {
  return routeWithStorageScope(input, input.payload, (storageScope) =>
    Effect.gen(function* () {
      const item = yield* getExtensionStorageItem(
        storageKey({
          invocation: input.invocation,
          packageScope: input.packageScope,
          storageKind: input.payload.storageKind,
          storageScope,
          key: input.payload.key,
        }),
      )
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
          storageKind: input.payload.storageKind,
          storageScope,
          key: input.payload.key,
          value: item?.value ?? null,
        },
      })
    }),
  )
}

export function routeStorageSet(
  input: StorageRouteInput & { readonly payload: ExtensionStorageSetPayload },
) {
  return routeWithStorageScope(input, input.payload, (storageScope) =>
    Effect.gen(function* () {
      const item = yield* setExtensionStorageItem({
        ...storageKey({
          invocation: input.invocation,
          packageScope: input.packageScope,
          storageKind: input.payload.storageKind,
          storageScope,
          key: input.payload.key,
        }),
        value: input.payload.value,
      })
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
          storageKind: item.storageKind,
          storageScope: item.storageScope,
          key: item.key,
          value: item.value,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      })
    }),
  )
}

export function routeStorageDelete(
  input: StorageRouteInput & { readonly payload: ExtensionStorageDeletePayload },
) {
  return routeWithStorageScope(input, input.payload, (storageScope) =>
    Effect.gen(function* () {
      yield* deleteExtensionStorageItem(
        storageKey({
          invocation: input.invocation,
          packageScope: input.packageScope,
          storageKind: input.payload.storageKind,
          storageScope,
          key: input.payload.key,
        }),
      )
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
          storageKind: input.payload.storageKind,
          storageScope,
          key: input.payload.key,
          deleted: true,
        },
      })
    }),
  )
}

export function routeStorageList(
  input: StorageRouteInput & { readonly payload: ExtensionStorageListPayload },
) {
  return routeWithStorageScope(input, input.payload, (storageScope) =>
    Effect.gen(function* () {
      const keys = yield* listExtensionStorageKeys(
        storageKeyListInput({
          invocation: input.invocation,
          packageScope: input.packageScope,
          storageKind: input.payload.storageKind,
          storageScope,
        }),
      )
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
          storageKind: input.payload.storageKind,
          storageScope,
          keys,
        },
      })
    }),
  )
}
