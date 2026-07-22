import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { JsonValue } from '@shared/types/json'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionStorageRepositoryError } from '../errors'
import type { ExtensionPackageScope } from '../extensions/types'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>

export type ExtensionStorageScope =
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND
    }
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND
      readonly projectPath: string
    }

export interface ExtensionStorageKey {
  readonly extensionId: string
  readonly packageScope: ExtensionPackageScope
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly key: string
}

export interface ExtensionStorageItem extends ExtensionStorageKey {
  readonly value: JsonValue
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ExtensionStorageKeyListInput {
  readonly extensionId: string
  readonly packageScope: ExtensionPackageScope
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
}

export interface ExtensionStorageRepositoryShape {
  readonly get: (
    key: ExtensionStorageKey,
  ) => EffectType<ExtensionStorageItem | null, ExtensionStorageRepositoryError>
  readonly upsert: (item: ExtensionStorageItem) => EffectType<void, ExtensionStorageRepositoryError>
  readonly delete: (key: ExtensionStorageKey) => EffectType<void, ExtensionStorageRepositoryError>
  readonly listKeys: (
    input: ExtensionStorageKeyListInput,
  ) => EffectType<readonly string[], ExtensionStorageRepositoryError>
}

export class ExtensionStorageRepository extends Context.Tag(
  '@openwaggle/ExtensionStorageRepository',
)<ExtensionStorageRepository, ExtensionStorageRepositoryShape>() {}
