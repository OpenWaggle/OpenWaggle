/**
 * The daily website visitor key (Website section of docs/specs/usage-statistics-fields.md).
 * A random salt is created for each UTC day, kept only in KV and only until that day ends, and
 * hashed with the address, User-Agent and host. Keys cannot be linked across days or back to an
 * address, and the address itself is never stored.
 */
import type { KeyValueStore } from './cloudflare'
import { encodeUtf8 } from './http'
import { epochDay, MS_PER_DAY, MS_PER_SECOND, utcDay } from './time'

export const WEB_SALT_KEY_PREFIX = 'web-salt:'
const SALT_BYTES = 32
/** KV refuses an expiry less than a minute ahead. */
const KV_MINIMUM_EXPIRY_SECONDS = 60
const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2

export function hexEncode(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join(
    '',
  )
}

/**
 * Absolute KV expiry of a salt created at `now`: the end of its UTC day. KV's one-minute minimum
 * applies only to a salt created in the day's last minute, which then outlives the day by at
 * most that minute; it is never used after its day, since the key names the day.
 */
export function saltExpiry(now: number) {
  const endOfDay = (epochDay(now) + 1) * MS_PER_DAY
  const earliest = Math.ceil(now / MS_PER_SECOND) + KV_MINIMUM_EXPIRY_SECONDS
  return Math.max(Math.ceil(endOfDay / MS_PER_SECOND), earliest)
}

/**
 * Salts held in this isolate's memory when KV fails, one per UTC day and dropped when the day
 * changes. Visitors then get a key per isolate instead of per day, which over-counts them a
 * little but never stops a page view from being counted.
 */
export class IsolateSalts {
  private day: string | undefined
  private salt: string | undefined

  saltFor(day: string, create: () => string) {
    if (this.day !== day || this.salt === undefined) {
      this.day = day
      this.salt = create()
    }
    return this.salt
  }
}

const ISOLATE_SALTS = new IsolateSalts()

async function storedSalt(store: KeyValueStore, key: string) {
  try {
    const value = await store.get(key)
    return { ok: true, salt: value === null || value === '' ? undefined : value } as const
  } catch {
    return { ok: false } as const
  }
}

/**
 * The salt of the UTC day containing `now`, created on the day's first beacon. KV is eventually
 * consistent and refuses a second write to a key within a second, so a failed write is followed
 * by a read that picks up the salt another request wrote; when KV cannot serve either, the
 * isolate's own salt for the day is used and the request still succeeds.
 */
export async function dailySalt(
  store: KeyValueStore,
  now: number,
  randomBytes: (length: number) => Uint8Array,
  fallback: IsolateSalts = ISOLATE_SALTS,
): Promise<string> {
  const day = utcDay(now)
  const key = `${WEB_SALT_KEY_PREFIX}${day}`
  const create = () => hexEncode(randomBytes(SALT_BYTES))
  const existing = await storedSalt(store, key)
  if (!existing.ok) return fallback.saltFor(day, create)
  if (existing.salt !== undefined) return existing.salt
  const salt = create()
  try {
    await store.put(key, salt, { expiration: saltExpiry(now) })
    return salt
  } catch {
    const written = await storedSalt(store, key)
    if (written.ok && written.salt !== undefined) return written.salt
    return fallback.saltFor(day, () => salt)
  }
}

export interface VisitorKeyInput {
  readonly salt: string
  readonly address: string
  readonly userAgent: string
  readonly host: string
}

/** SHA-256 of the salt, address, User-Agent and host. Only the hash leaves this function. */
export async function visitorKey(input: VisitorKeyInput): Promise<string> {
  const material = [input.salt, input.address, input.userAgent, input.host].join('\n')
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(material))
  return hexEncode(new Uint8Array(digest))
}
