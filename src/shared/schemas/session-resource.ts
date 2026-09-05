import { Schema } from '../schema'

const MAX_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 512
const MAX_URL_LENGTH = 4096

function isTrimmedNonEmpty(value: string) {
  return value.trim() === value && value.length > 0
}

function isSafeOpaqueId(value: string) {
  return isTrimmedNonEmpty(value) && /^[a-z0-9][a-z0-9._:-]*$/iu.test(value)
}

function isSupportedChangeRequestUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    return (
      /\/pull\/\d+\/?$/u.test(url.pathname) || /\/-\/merge_requests\/\d+\/?$/u.test(url.pathname)
    )
  } catch {
    return false
  }
}

export const sessionResourceSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_ID_LENGTH),
  Schema.filter(isSafeOpaqueId),
)

export const sessionResourceIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_ID_LENGTH),
  Schema.filter(isSafeOpaqueId),
)

export const recordSessionChangeRequestInputSchema = Schema.Struct({
  title: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(MAX_TITLE_LENGTH),
    Schema.filter(isTrimmedNonEmpty),
  ),
  url: Schema.String.pipe(
    Schema.maxLength(MAX_URL_LENGTH),
    Schema.filter(isSupportedChangeRequestUrl),
  ),
})
