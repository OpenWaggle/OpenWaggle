import type { WaggleConfig, WagglePreset } from '@openwaggle/waggle-core'

export type WaggleMenuAction =
  | { readonly type: 'disable' }
  | { readonly type: 'activate-preset'; readonly preset: WagglePreset }
  | { readonly type: 'preset-actions'; readonly preset: WagglePreset; readonly active: boolean }
  | {
      readonly type: 'active-config-actions'
      readonly config: WaggleConfig
      readonly preset?: WagglePreset
    }
  | { readonly type: 'create-preset' }
  | { readonly type: 'manage-presets' }

export interface WaggleControlCenterRow {
  readonly label: string
  readonly details: readonly string[]
  readonly primaryAction: WaggleMenuAction
  readonly secondaryAction?: WaggleMenuAction
}
