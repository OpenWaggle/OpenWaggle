import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionPackageRepositoryError } from '../errors'
import type { ExtensionPackageScope } from '../extensions/types'

export type ExtensionPackageWriteMode = 'create' | 'update'

export interface ExtensionPackageFileWrite {
  readonly relativePath: string
  readonly content: string
}

export interface WriteExtensionPackageInput {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly mode: ExtensionPackageWriteMode
  readonly files: readonly ExtensionPackageFileWrite[]
}

export interface WriteExtensionPackageResult {
  readonly packagePath: string
  readonly manifestPath: string
  readonly mode: ExtensionPackageWriteMode
}

export interface RemoveExtensionPackageInput {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
}

export interface RemoveExtensionPackageResult {
  readonly packagePath: string
  readonly removed: boolean
}

export interface ExtensionPackageRepositoryShape {
  readonly writePackage: (
    input: WriteExtensionPackageInput,
  ) => EffectType<WriteExtensionPackageResult, ExtensionPackageRepositoryError>
  readonly removePackage: (
    input: RemoveExtensionPackageInput,
  ) => EffectType<RemoveExtensionPackageResult, ExtensionPackageRepositoryError>
}

export class ExtensionPackageRepository extends Context.Tag(
  '@openwaggle/ExtensionPackageRepository',
)<ExtensionPackageRepository, ExtensionPackageRepositoryShape>() {}
