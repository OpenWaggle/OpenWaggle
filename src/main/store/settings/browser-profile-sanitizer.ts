import { safeDecodeUnknown } from '@shared/schema'
import { browserProfileSchema } from '@shared/schemas/browser-profile'
import type { BrowserProfile } from '@shared/types/browser-profile'
import {
  BROWSER_PROFILE_LIMITS,
  DEFAULT_BROWSER_PROFILE_ID,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
} from '@shared/types/browser-profile'

export function sanitizeBrowserProfiles(raw: unknown): readonly BrowserProfile[] {
  if (!Array.isArray(raw)) return []
  const profiles: BrowserProfile[] = []
  const seen = new Set<string>()
  for (const candidate of raw.slice(0, BROWSER_PROFILE_LIMITS.USER_PROFILES)) {
    const decoded = safeDecodeUnknown(browserProfileSchema, candidate)
    if (!decoded.success || isBuiltInBrowserProfileId(decoded.data.id)) continue
    if (seen.has(decoded.data.id)) continue
    seen.add(decoded.data.id)
    profiles.push({ ...decoded.data, kind: 'persistent' })
  }
  return profiles
}

export function resolveBrowserDefaultProfileId(
  raw: unknown,
  userProfiles: readonly BrowserProfile[],
) {
  if (typeof raw !== 'string') return DEFAULT_BROWSER_PROFILE_ID
  return resolveBrowserProfiles(userProfiles).some((profile) => profile.id === raw)
    ? raw
    : DEFAULT_BROWSER_PROFILE_ID
}
