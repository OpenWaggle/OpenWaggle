import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import type { SessionHostEventHub } from '../application/session-host-event-hub'
import type { SessionHostEventReplayView } from '../application/session-host-event-replay-views'
import { createLocalSessionEventAdmissionFilter } from './local-session-event-admission'

const CURSOR_CIPHER = 'aes-256-gcm'
const CURSOR_KEY_BYTES = 32
const CURSOR_IV_BYTES = 12
const CURSOR_TAG_BYTES = 16
const CURSOR_HOST_LENGTH_BYTES = 2
const CURSOR_SEQUENCE_BYTES = 8
const CURSOR_SEQUENCE = 0
const MAX_INTERNAL_SEQUENCE = BigInt(Number.MAX_SAFE_INTEGER)
// 128 × 256 KiB bounds restricted replay payload retention to 32 MiB. The event cap adds at
// most 32,768 shared envelope references, and publish work is bounded by the same 128 views.
const DEFAULT_MAX_REPLAY_AUTHORITIES = 128
const DEFAULT_REPLAY_EVENTS_PER_AUTHORITY = 256
const DEFAULT_REPLAY_BYTES_PER_AUTHORITY = 256 * 1024

interface RestrictedReplayState {
  readonly authority: string
  readonly profileId: string
  readonly view: SessionHostEventReplayView
  readonly updateCaller: (caller: LocalSessionCallerIdentity) => void
}

export interface LocalSessionEventCursorProjectionOptions {
  readonly maxReplayAuthorities?: number
  readonly replayEventsPerAuthority?: number
  readonly replayBytesPerAuthority?: number
}

export type LocalSessionCursorResolution =
  | { readonly status: 'ready'; readonly cursor: SessionHostEventCursor }
  | {
      readonly status: 'resync-required'
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead'
      readonly cursor: SessionHostEventCursor
    }

function authorityKey(caller: LocalSessionCallerIdentity) {
  const authority = caller.profileAuthority
  return authority ? `${caller.callerId}\0${authority.profileId}` : undefined
}

function encodeInternalCursor(cursor: SessionHostEventCursor) {
  const host = Buffer.from(cursor.hostInstanceId, 'utf8')
  const plaintext = Buffer.alloc(CURSOR_HOST_LENGTH_BYTES + host.byteLength + CURSOR_SEQUENCE_BYTES)
  plaintext.writeUInt16BE(host.byteLength, 0)
  host.copy(plaintext, CURSOR_HOST_LENGTH_BYTES)
  plaintext.writeBigUInt64BE(BigInt(cursor.sequence), CURSOR_HOST_LENGTH_BYTES + host.byteLength)
  return plaintext
}

function decodeInternalCursor(plaintext: Buffer): SessionHostEventCursor | undefined {
  if (plaintext.byteLength < CURSOR_HOST_LENGTH_BYTES + CURSOR_SEQUENCE_BYTES) return
  const hostLength = plaintext.readUInt16BE(0)
  const expectedLength = CURSOR_HOST_LENGTH_BYTES + hostLength + CURSOR_SEQUENCE_BYTES
  if (hostLength === 0 || plaintext.byteLength !== expectedLength) return
  const sequence = plaintext.readBigUInt64BE(CURSOR_HOST_LENGTH_BYTES + hostLength)
  if (sequence > MAX_INTERNAL_SEQUENCE) return
  return {
    hostInstanceId: plaintext
      .subarray(CURSOR_HOST_LENGTH_BYTES, CURSOR_HOST_LENGTH_BYTES + hostLength)
      .toString('utf8'),
    sequence: Number(sequence),
  }
}

/**
 * Projects the Host's ordered event cursor into an opaque capability for restricted callers.
 * Random authenticated encryption makes every exposure unlinkable, including unchanged snapshots,
 * while retaining stateless resume across connections to the same Host instance.
 */
export class LocalSessionEventCursorProjection {
  readonly #instanceId = randomUUID()
  readonly #key = randomBytes(CURSOR_KEY_BYTES)
  readonly #maxReplayAuthorities: number
  readonly #replayEventsPerAuthority: number
  readonly #replayBytesPerAuthority: number
  readonly #statesByAuthority = new Map<string, RestrictedReplayState>()
  readonly #statesByView = new Map<string, RestrictedReplayState>()

  constructor(
    private readonly eventHub: SessionHostEventHub,
    options: LocalSessionEventCursorProjectionOptions = {},
  ) {
    this.#maxReplayAuthorities = options.maxReplayAuthorities ?? DEFAULT_MAX_REPLAY_AUTHORITIES
    this.#replayEventsPerAuthority =
      options.replayEventsPerAuthority ?? DEFAULT_REPLAY_EVENTS_PER_AUTHORITY
    this.#replayBytesPerAuthority =
      options.replayBytesPerAuthority ?? DEFAULT_REPLAY_BYTES_PER_AUTHORITY
    for (const [name, value] of [
      ['authority', this.#maxReplayAuthorities],
      ['event', this.#replayEventsPerAuthority],
      ['byte', this.#replayBytesPerAuthority],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(
          `Restricted cursor replay ${name} capacity must be a positive safe integer.`,
        )
      }
    }
  }

  expose(
    caller: LocalSessionCallerIdentity,
    internal: SessionHostEventCursor,
  ): SessionHostEventCursor {
    const authority = authorityKey(caller)
    if (!authority) return internal
    const scoped = this.bindReplayCursor(caller, internal)
    const iv = randomBytes(CURSOR_IV_BYTES)
    const cipher = createCipheriv(CURSOR_CIPHER, this.#key, iv)
    cipher.setAAD(Buffer.from(authority, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(encodeInternalCursor(scoped)), cipher.final()])
    const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
    return {
      hostInstanceId: `${this.#instanceId}.${token}`,
      sequence: CURSOR_SEQUENCE,
    }
  }

  bindReplayCursor(
    caller: LocalSessionCallerIdentity,
    internal: SessionHostEventCursor,
  ): SessionHostEventCursor {
    const authority = authorityKey(caller)
    if (!authority) return internal
    const state = this.#stateFor(caller, authority)
    return { hostInstanceId: state.view.hostInstanceId, sequence: internal.sequence }
  }

  exposeEvent(
    caller: LocalSessionCallerIdentity,
    event: SessionHostEventEnvelope,
  ): SessionHostEventEnvelope {
    const cursor = this.expose(caller, event.cursor)
    return cursor === event.cursor ? event : { ...event, cursor }
  }

  resolve(
    caller: LocalSessionCallerIdentity,
    external: SessionHostEventCursor,
  ): LocalSessionCursorResolution {
    const authority = authorityKey(caller)
    if (!authority) return { status: 'ready', cursor: external }
    const prefix = `${this.#instanceId}.`
    if (!external.hostInstanceId.startsWith(prefix)) {
      return this.#resync(caller, 'host-restarted')
    }
    if (external.sequence !== CURSOR_SEQUENCE) {
      return this.#resync(caller, 'cursor-ahead')
    }
    const encodedToken = external.hostInstanceId.slice(prefix.length)
    const token = Buffer.from(encodedToken, 'base64url')
    if (token.toString('base64url') !== encodedToken) {
      return this.#resync(caller, 'cursor-expired')
    }
    const minimumLength = CURSOR_IV_BYTES + CURSOR_TAG_BYTES
    if (token.byteLength <= minimumLength) return this.#resync(caller, 'cursor-expired')
    try {
      const iv = token.subarray(0, CURSOR_IV_BYTES)
      const tag = token.subarray(CURSOR_IV_BYTES, minimumLength)
      const ciphertext = token.subarray(minimumLength)
      const decipher = createDecipheriv(CURSOR_CIPHER, this.#key, iv)
      decipher.setAAD(Buffer.from(authority, 'utf8'))
      decipher.setAuthTag(tag)
      const internal = decodeInternalCursor(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      )
      if (!internal) return this.#resync(caller, 'cursor-expired')
      const state = this.#statesByView.get(internal.hostInstanceId)
      if (!state || state.authority !== authority) return this.#resync(caller, 'cursor-expired')
      this.#touch(state)
      return { status: 'ready', cursor: internal }
    } catch {
      return this.#resync(caller, 'cursor-expired')
    }
  }

  invalidateProfile(profileId?: string) {
    for (const state of [...this.#statesByAuthority.values()]) {
      if (!profileId || state.profileId === profileId) this.#remove(state)
    }
  }

  rotateProfile(profileId?: string) {
    for (const state of this.#statesByAuthority.values()) {
      if (profileId && state.profileId !== profileId) continue
      const previousHostInstanceId = state.view.hostInstanceId
      this.#statesByView.delete(previousHostInstanceId)
      if (this.eventHub.rotateReplayView(state.view)) {
        this.#statesByView.set(state.view.hostInstanceId, state)
      } else {
        this.#remove(state)
      }
    }
  }

  refreshCaller(caller: LocalSessionCallerIdentity) {
    const authority = authorityKey(caller)
    if (!authority) return
    this.#statesByAuthority.get(authority)?.updateCaller(caller)
  }

  replayUsage() {
    let entries = 0
    let bytes = 0
    for (const state of this.#statesByAuthority.values()) {
      const usage = state.view.usage()
      entries += usage.entries
      bytes += usage.bytes
    }
    const eventHubLimits = this.eventHub.replayLimits()
    const maxEntries =
      this.#maxReplayAuthorities * Math.min(eventHubLimits.capacity, this.#replayEventsPerAuthority)
    const maxBytes =
      this.#maxReplayAuthorities *
      Math.min(eventHubLimits.byteCapacity, this.#replayBytesPerAuthority)
    return {
      authorities: this.#statesByAuthority.size,
      entries,
      bytes,
      maxAuthorities: this.#maxReplayAuthorities,
      maxEntries,
      maxBytes,
    }
  }

  #stateFor(caller: LocalSessionCallerIdentity, authority: string) {
    const current = this.#statesByAuthority.get(authority)
    if (current) {
      this.#touch(current)
      return current
    }
    while (this.#statesByAuthority.size >= this.#maxReplayAuthorities) {
      const oldest = this.#statesByAuthority.values().next().value
      if (!oldest) break
      this.#remove(oldest)
    }
    const eventHubLimits = this.eventHub.replayLimits()
    let admittedCaller = caller
    const view = this.eventHub.createReplayView(
      createLocalSessionEventAdmissionFilter(() => admittedCaller),
      {
        capacity: Math.min(eventHubLimits.capacity, this.#replayEventsPerAuthority),
        byteCapacity: Math.min(eventHubLimits.byteCapacity, this.#replayBytesPerAuthority),
      },
    )
    const state = {
      authority,
      profileId: caller.profileAuthority?.profileId ?? '',
      view,
      updateCaller: (nextCaller) => {
        admittedCaller = nextCaller
      },
    } satisfies RestrictedReplayState
    this.#statesByAuthority.set(authority, state)
    this.#statesByView.set(view.hostInstanceId, state)
    return state
  }

  #touch(state: RestrictedReplayState) {
    this.#statesByAuthority.delete(state.authority)
    this.#statesByAuthority.set(state.authority, state)
  }

  #remove(state: RestrictedReplayState) {
    this.#statesByAuthority.delete(state.authority)
    this.#statesByView.delete(state.view.hostInstanceId)
    state.view.close()
  }

  #resync(
    caller: LocalSessionCallerIdentity,
    reason: Exclude<LocalSessionCursorResolution, { readonly status: 'ready' }>['reason'],
  ): LocalSessionCursorResolution {
    return {
      status: 'resync-required',
      reason,
      cursor: this.expose(caller, this.eventHub.cursor()),
    }
  }
}
