import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionLifecycleRepositoryError } from '../errors'
import type {
  ExtensionLifecycleKey,
  ExtensionLifecycleState,
  ExtensionPackageScope,
} from '../extensions/types'

export interface ExtensionLifecycleRepositoryShape {
  readonly get: (
    key: ExtensionLifecycleKey,
  ) => EffectType<ExtensionLifecycleState | null, ExtensionLifecycleRepositoryError>
  readonly list: (
    scope: ExtensionPackageScope,
  ) => EffectType<readonly ExtensionLifecycleState[], ExtensionLifecycleRepositoryError>
  readonly upsert: (
    state: ExtensionLifecycleState,
  ) => EffectType<void, ExtensionLifecycleRepositoryError>
  readonly delete?: (
    key: ExtensionLifecycleKey,
  ) => EffectType<void, ExtensionLifecycleRepositoryError>
}

export class ExtensionLifecycleRepository extends Context.Tag(
  '@openwaggle/ExtensionLifecycleRepository',
)<ExtensionLifecycleRepository, ExtensionLifecycleRepositoryShape>() {}
