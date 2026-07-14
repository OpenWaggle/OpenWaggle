import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { JsonValue } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ExtensionStorageItem,
  type ExtensionStorageKey,
  ExtensionStorageRepository,
} from '../../ports/extension-storage-repository'
import {
  deleteExtensionStorageItem,
  getExtensionStorageItem,
  listExtensionStorageKeys,
  setExtensionStorageItem,
} from '../extension-storage-service'

const STORAGE_KEY: ExtensionStorageKey = {
  extensionId: 'sample-extension',
  packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
  storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
  key: 'settings',
}

function storageItem(value: JsonValue): ExtensionStorageItem {
  return {
    ...STORAGE_KEY,
    value,
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function makeLayer(initialItem: ExtensionStorageItem | null = null) {
  let item = initialItem
  return {
    layer: Layer.succeed(ExtensionStorageRepository, {
      get: () => Effect.sync(() => item),
      upsert: (nextItem) =>
        Effect.sync(() => {
          item = nextItem
        }),
      delete: () =>
        Effect.sync(() => {
          item = null
        }),
      listKeys: () => Effect.succeed(item ? [item.key] : []),
    }),
    getItem: () => item,
  }
}

describe('extension storage service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(5000))
  })

  it('writes extension storage values and preserves createdAt on update', async () => {
    const harness = makeLayer(storageItem('old'))

    const result = await Effect.runPromise(
      setExtensionStorageItem({ ...STORAGE_KEY, value: 'new' }).pipe(Effect.provide(harness.layer)),
    )

    expect(result).toEqual({
      ...STORAGE_KEY,
      value: 'new',
      createdAt: 1000,
      updatedAt: 5000,
    })
    expect(harness.getItem()).toEqual(result)
  })

  it('reads, lists, and deletes extension storage through the repository', async () => {
    const harness = makeLayer(storageItem({ enabled: true }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const itemBeforeDelete = yield* getExtensionStorageItem(STORAGE_KEY)
        const keysBeforeDelete = yield* listExtensionStorageKeys(STORAGE_KEY)
        yield* deleteExtensionStorageItem(STORAGE_KEY)
        const itemAfterDelete = yield* getExtensionStorageItem(STORAGE_KEY)
        return { itemBeforeDelete, keysBeforeDelete, itemAfterDelete }
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(result.itemBeforeDelete?.value).toEqual({ enabled: true })
    expect(result.keysBeforeDelete).toEqual(['settings'])
    expect(result.itemAfterDelete).toBeNull()
  })

  it('rejects invalid storage keys before repository writes', async () => {
    const harness = makeLayer()

    await expect(
      Effect.runPromise(
        setExtensionStorageItem({ ...STORAGE_KEY, key: ' ', value: 'invalid' }).pipe(
          Effect.provide(harness.layer),
        ),
      ),
    ).rejects.toThrow('Extension storage key must not be empty.')
    expect(harness.getItem()).toBeNull()
  })
})
