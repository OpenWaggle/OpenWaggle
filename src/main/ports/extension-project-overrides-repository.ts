import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionProjectOverrideRepositoryError } from '../errors'
import type {
  ExtensionProjectOverrideKey,
  ExtensionProjectOverrideState,
} from '../extensions/types'

export interface ExtensionProjectOverridesRepositoryShape {
  readonly get: (
    key: ExtensionProjectOverrideKey,
  ) => EffectType<ExtensionProjectOverrideState | null, ExtensionProjectOverrideRepositoryError>
  readonly upsert: (
    state: ExtensionProjectOverrideState,
  ) => EffectType<void, ExtensionProjectOverrideRepositoryError>
}

export class ExtensionProjectOverridesRepository extends Context.Tag(
  '@openwaggle/ExtensionProjectOverridesRepository',
)<ExtensionProjectOverridesRepository, ExtensionProjectOverridesRepositoryShape>() {}
