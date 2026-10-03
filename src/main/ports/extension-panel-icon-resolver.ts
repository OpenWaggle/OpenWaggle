import type { ExtensionSidePanelIcon } from '@shared/schemas/extensions'
import type { ExtensionContributionIconView } from '@shared/types/extension-contribution-registry'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

export interface ExtensionPanelIconRequest {
  readonly packagePath: string
  /** The installed package content hash; SVG icon files are part of it, so it keys the cache. */
  readonly contentHash: string
  readonly icon: ExtensionSidePanelIcon
}

export type ExtensionPanelIconResolution =
  | { readonly status: 'resolved'; readonly icon: ExtensionContributionIconView }
  | { readonly status: 'invalid'; readonly message: string; readonly path?: string }

export interface ExtensionPanelIconResolverShape {
  /** Never fails: an unusable icon is reported as `invalid` so the panel falls back to a letter. */
  readonly resolve: (request: ExtensionPanelIconRequest) => EffectType<ExtensionPanelIconResolution>
}

export class ExtensionPanelIconResolver extends Context.Tag(
  '@openwaggle/ExtensionPanelIconResolver',
)<ExtensionPanelIconResolver, ExtensionPanelIconResolverShape>() {}
