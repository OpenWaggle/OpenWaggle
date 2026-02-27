import type { Settings } from '@shared/types/settings'

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return ''
  const prefix = key.slice(0, key.indexOf('-') > 0 ? key.indexOf('-', key.indexOf('-') + 1) + 1 : 4)
  const suffix = key.slice(-4)
  const visiblePrefix = prefix.length > 8 ? prefix.slice(0, 8) : prefix
  return `${visiblePrefix}${'••••••'}${suffix}`
}

export function hasAnyApiKey(providers: Settings['providers']): boolean {
  return Object.values(providers).some((config) => {
    if (!config) return false
    return config.apiKey.trim().length > 0
  })
}
