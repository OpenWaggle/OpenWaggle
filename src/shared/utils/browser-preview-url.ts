import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'

const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/#?]|$)/iu

/** Canonicalizes address-bar style input while rejecting non-HTTP and credentialed URLs. */
export function normalizeBrowserPreviewAddress(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > BROWSER_PREVIEW_LIMITS.URL_LENGTH) return null
  const candidate = EXPLICIT_SCHEME.test(trimmed)
    ? trimmed
    : `${LOCAL_HOST.test(trimmed) ? 'http' : 'https'}://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}
