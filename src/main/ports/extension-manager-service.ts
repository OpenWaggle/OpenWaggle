import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'
import type { ExtensionDiscoveryError } from '../errors'
import type { DiscoveredExtensionPackage } from '../extensions/types'

export interface ListExtensionPackagesInput {
  readonly projectPath?: string | null
}

export interface ExtensionManagerServiceShape {
  readonly listPackages: (
    input: ListExtensionPackagesInput,
  ) => EffectType<readonly DiscoveredExtensionPackage[], ExtensionDiscoveryError>
}

export class ExtensionManagerService extends Context.Tag('@openwaggle/ExtensionManagerService')<
  ExtensionManagerService,
  ExtensionManagerServiceShape
>() {}
