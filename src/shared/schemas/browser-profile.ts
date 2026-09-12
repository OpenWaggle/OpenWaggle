import { Schema } from '@shared/schema'
import type { BrowserProfile } from '@shared/types/browser-profile'
import { BROWSER_PROFILE_KINDS, BROWSER_PROFILE_LIMITS } from '@shared/types/browser-profile'

export function isBrowserProfileId(value: string) {
  return (
    (value === value.trim() &&
      value.length > 0 &&
      value.length <= BROWSER_PROFILE_LIMITS.ID_LENGTH &&
      !/[\p{Cc}]/u.test(value)) ||
    'Browser profile ids must be trimmed, non-empty, and contain no control characters.'
  )
}

export const browserProfileIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PROFILE_LIMITS.ID_LENGTH),
  Schema.filter(isBrowserProfileId),
)

export const browserProfileNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PROFILE_LIMITS.NAME_LENGTH),
  Schema.filter(
    (name) =>
      (name === name.trim() && !/[\p{Cc}]/u.test(name)) ||
      'Browser profile names must be trimmed and contain no control characters.',
  ),
)

export const browserProfileSchema: Schema.Schema<BrowserProfile> = Schema.Struct({
  id: browserProfileIdSchema,
  name: browserProfileNameSchema,
  kind: Schema.Literal(...BROWSER_PROFILE_KINDS),
})

export const browserProfilesSchema = Schema.Array(browserProfileSchema).pipe(
  Schema.maxItems(BROWSER_PROFILE_LIMITS.USER_PROFILES),
)
