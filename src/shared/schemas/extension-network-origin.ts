import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

export function isNetworkOrigin(value: string) {
  const trimmed = value.trim()
  if (value !== trimmed) {
    return 'Must not have leading or trailing whitespace.'
  }
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.NETWORK_ORIGIN_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.NETWORK_ORIGIN_MAX_LENGTH} characters.`
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Must be a valid URL origin.'
  }

  if (url.protocol !== 'https:') {
    return 'Must use https.'
  }
  if (url.origin !== value) {
    return 'Must be an exact origin without a path, query, fragment, or trailing slash.'
  }

  return true
}
