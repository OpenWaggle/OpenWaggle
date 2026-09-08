export const BROWSER_PROFILE_LIMITS = {
  ID_LENGTH: 64,
  NAME_LENGTH: 48,
  USER_PROFILES: 24,
} as const

export const BROWSER_PROFILE_KINDS = ['persistent', 'incognito'] as const
export type BrowserProfileKind = (typeof BROWSER_PROFILE_KINDS)[number]

export interface BrowserProfile {
  readonly id: string
  readonly name: string
  readonly kind: BrowserProfileKind
}

export const DEFAULT_BROWSER_PROFILE_ID = 'default'
export const INCOGNITO_BROWSER_PROFILE_ID = 'incognito'

export const BUILT_IN_BROWSER_PROFILES: readonly BrowserProfile[] = [
  { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default', kind: 'persistent' },
  { id: INCOGNITO_BROWSER_PROFILE_ID, name: 'Incognito', kind: 'incognito' },
]

export function isBuiltInBrowserProfileId(id: string) {
  return BUILT_IN_BROWSER_PROFILES.some((profile) => profile.id === id)
}

/** Built-ins always win. Duplicate user ids keep their first valid definition. */
export function resolveBrowserProfiles(userProfiles: readonly BrowserProfile[]) {
  const seen = new Set(BUILT_IN_BROWSER_PROFILES.map((profile) => profile.id))
  const profiles: BrowserProfile[] = [...BUILT_IN_BROWSER_PROFILES]

  for (const profile of userProfiles.slice(0, BROWSER_PROFILE_LIMITS.USER_PROFILES)) {
    if (seen.has(profile.id)) continue
    seen.add(profile.id)
    profiles.push(profile.kind === 'persistent' ? profile : { ...profile, kind: 'persistent' })
  }

  return profiles
}

export function findBrowserProfile(profiles: readonly BrowserProfile[], id: string | undefined) {
  return id === undefined ? undefined : profiles.find((profile) => profile.id === id)
}
