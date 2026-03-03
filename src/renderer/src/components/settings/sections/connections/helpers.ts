import type { Settings } from '@shared/types/settings'

const MASK_API_KEY_VALUE_8 = 8
const MASK_API_KEY_VALUE_4 = 4
const SLICE_ARG_1 = -4
const SLICE_ARG_2 = 8

export function maskApiKey(key: string): string {
  if (!key || key.length < MASK_API_KEY_VALUE_8) return ''
  const prefix = key.slice(
    0,
    key.indexOf('-') > 0 ? key.indexOf('-', key.indexOf('-') + 1) + 1 : MASK_API_KEY_VALUE_4,
  )
  const suffix = key.slice(SLICE_ARG_1)
  const visiblePrefix = prefix.length > MASK_API_KEY_VALUE_8 ? prefix.slice(0, SLICE_ARG_2) : prefix
  return `${visiblePrefix}${'••••••'}${suffix}`
}

export function hasAnyApiKey(providers: Settings['providers']): boolean {
  return Object.values(providers).some((config) => {
    if (!config) return false
    return config.apiKey.trim().length > 0
  })
}
