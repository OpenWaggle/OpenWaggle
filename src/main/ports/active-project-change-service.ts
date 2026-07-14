import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

export interface ActiveProjectChangeServiceShape {
  readonly reconcileTrustedMainExtensions: (projectPath: string | null) => EffectType<void>
}

export class ActiveProjectChangeService extends Context.Tag(
  '@openwaggle/ActiveProjectChangeService',
)<ActiveProjectChangeService, ActiveProjectChangeServiceShape>() {}
