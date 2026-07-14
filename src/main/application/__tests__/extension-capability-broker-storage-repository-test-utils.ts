import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  type ExtensionStorageItem,
  type ExtensionStorageKey,
  type ExtensionStorageKeyListInput,
  ExtensionStorageRepository,
} from '../../ports/extension-storage-repository'

function packageScopesMatch(
  left: ExtensionStorageKey['packageScope'],
  right: ExtensionStorageKey['packageScope'],
) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

function storageScopesMatch(
  left: ExtensionStorageKey['storageScope'],
  right: ExtensionStorageKey['storageScope'],
) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    right.kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND &&
    left.projectPath === right.projectPath
  )
}

function storageKeyMatches(left: ExtensionStorageKey, right: ExtensionStorageKey) {
  return (
    left.extensionId === right.extensionId &&
    packageScopesMatch(left.packageScope, right.packageScope) &&
    left.storageKind === right.storageKind &&
    storageScopesMatch(left.storageScope, right.storageScope) &&
    left.key === right.key
  )
}

function storageListInputMatches(item: ExtensionStorageItem, input: ExtensionStorageKeyListInput) {
  return (
    item.extensionId === input.extensionId &&
    packageScopesMatch(item.packageScope, input.packageScope) &&
    item.storageKind === input.storageKind &&
    storageScopesMatch(item.storageScope, input.storageScope)
  )
}

export function makeExtensionStorageRepositoryLayer(items: ExtensionStorageItem[]) {
  return Layer.succeed(ExtensionStorageRepository, {
    get: (key) => Effect.succeed(items.find((item) => storageKeyMatches(item, key)) ?? null),
    upsert: (item) =>
      Effect.sync(() => {
        const existingIndex = items.findIndex((candidate) => storageKeyMatches(candidate, item))
        if (existingIndex >= 0) {
          items.splice(existingIndex, 1, item)
          return
        }
        items.push(item)
      }),
    delete: (key) =>
      Effect.sync(() => {
        const existingIndex = items.findIndex((candidate) => storageKeyMatches(candidate, key))
        if (existingIndex >= 0) {
          items.splice(existingIndex, 1)
        }
      }),
    listKeys: (input) =>
      Effect.succeed(
        items
          .filter((item) => storageListInputMatches(item, input))
          .map((item) => item.key)
          .sort(),
      ),
  })
}
