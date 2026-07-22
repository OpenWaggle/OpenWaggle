import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { JsonValue } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import {
  type ExtensionStorageItem,
  type ExtensionStorageKey,
  type ExtensionStorageKeyListInput,
  ExtensionStorageRepository,
} from '../ports/extension-storage-repository'

export interface WriteExtensionStorageInput extends ExtensionStorageKey {
  readonly value: JsonValue
}

function storageKeyError(message: string) {
  return new Error(message)
}

function validateKey(key: string) {
  if (key.trim().length === 0) {
    return Effect.fail(storageKeyError('Extension storage key must not be empty.'))
  }
  if (key !== key.trim()) {
    return Effect.fail(
      storageKeyError('Extension storage key must not have leading or trailing whitespace.'),
    )
  }
  if (key.length > OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH) {
    return Effect.fail(
      storageKeyError(
        `Extension storage key must be at most ${OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH} characters.`,
      ),
    )
  }
  return Effect.void
}

export function getExtensionStorageItem(key: ExtensionStorageKey) {
  return Effect.gen(function* () {
    yield* validateKey(key.key)
    const repository = yield* ExtensionStorageRepository
    return yield* repository.get(key)
  })
}

export function setExtensionStorageItem(input: WriteExtensionStorageInput) {
  return Effect.gen(function* () {
    yield* validateKey(input.key)
    const repository = yield* ExtensionStorageRepository
    const current = yield* repository.get(input)
    const updatedAt = Date.now()
    const item: ExtensionStorageItem = {
      ...input,
      createdAt: current?.createdAt ?? updatedAt,
      updatedAt,
    }

    yield* repository.upsert(item)
    return item
  })
}

export function deleteExtensionStorageItem(key: ExtensionStorageKey) {
  return Effect.gen(function* () {
    yield* validateKey(key.key)
    const repository = yield* ExtensionStorageRepository
    yield* repository.delete(key)
  })
}

export function listExtensionStorageKeys(input: ExtensionStorageKeyListInput) {
  return Effect.gen(function* () {
    const repository = yield* ExtensionStorageRepository
    return yield* repository.listKeys(input)
  })
}
