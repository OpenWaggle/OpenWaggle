import type { LocalSessionServerDependencies } from './local-session-server'

export const DEFAULT_MAX_CONNECTIONS = 128
export const MAX_DECODED_FRAMES_PER_CHUNK = 256
export const DEFAULT_MAX_PENDING_INBOUND_BYTES_GLOBAL = 64 * 1024 * 1024

const DEFAULT_MAX_CONCURRENT_AUTHENTICATIONS = 4
const DEFAULT_MAX_FAILED_AUTHENTICATION_ATTEMPTS = 5
const DEFAULT_MAX_FAILED_AUTHENTICATION_ATTEMPTS_GLOBAL = 32
const DEFAULT_AUTHENTICATION_FAILURE_WINDOW_MS = 30_000
const DEFAULT_AUTHENTICATION_COOLDOWN_MS = 30_000
const MAX_TRACKED_AUTHENTICATION_FAILURES = 1024

const DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION = 16
const DEFAULT_MAX_SUBSCRIPTIONS_GLOBAL = 256

export class LocalSessionInboundByteBudget {
  private retainedBytes = 0

  constructor(private readonly capacity = DEFAULT_MAX_PENDING_INBOUND_BYTES_GLOBAL) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Local Session inbound byte capacity must be a positive safe integer.')
    }
  }

  get pendingBytes() {
    return this.retainedBytes
  }

  reserve(bytes: number) {
    if (bytes < 0 || this.retainedBytes + bytes > this.capacity) return false
    this.retainedBytes += bytes
    return true
  }

  release(bytes: number) {
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes)
  }
}

interface AuthenticationWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly abort: () => void
}

interface AuthenticationFailures {
  readonly attempts: number
  readonly windowStartedAt: number
  readonly blockedUntil: number
}

function nextAuthenticationFailure(
  previous: AuthenticationFailures | undefined,
  now: number,
  failureWindowMs: number,
  cooldownMs: number,
  maxFailedAttempts: number,
): AuthenticationFailures {
  const withinWindow = previous && now - previous.windowStartedAt < failureWindowMs
  const attempts = withinWindow ? previous.attempts + 1 : 1
  return {
    attempts,
    windowStartedAt: withinWindow ? previous.windowStartedAt : now,
    blockedUntil: attempts >= maxFailedAttempts ? now + cooldownMs : 0,
  }
}

export interface LocalSessionAuthenticationBudgetOptions {
  readonly maxConcurrent?: number
  readonly maxFailedAttempts?: number
  readonly maxFailedAttemptsGlobal?: number
  readonly failureWindowMs?: number
  readonly cooldownMs?: number
  readonly now?: () => number
}

export class LocalSessionAuthenticationBudget {
  private readonly maxConcurrent: number
  private readonly maxFailedAttempts: number
  private readonly maxFailedAttemptsGlobal: number
  private readonly failureWindowMs: number
  private readonly cooldownMs: number
  private readonly now: () => number
  private active = 0
  private readonly waiting: AuthenticationWaiter[] = []
  private readonly failures = new Map<string, AuthenticationFailures>()
  private globalFailures: AuthenticationFailures | undefined

  constructor(options: LocalSessionAuthenticationBudgetOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_AUTHENTICATIONS
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_AUTHENTICATION_ATTEMPTS
    this.maxFailedAttemptsGlobal =
      options.maxFailedAttemptsGlobal ?? DEFAULT_MAX_FAILED_AUTHENTICATION_ATTEMPTS_GLOBAL
    this.failureWindowMs = options.failureWindowMs ?? DEFAULT_AUTHENTICATION_FAILURE_WINDOW_MS
    this.cooldownMs = options.cooldownMs ?? DEFAULT_AUTHENTICATION_COOLDOWN_MS
    this.now = options.now ?? Date.now
    for (const [name, value] of [
      ['concurrent authentication', this.maxConcurrent],
      ['failed authentication', this.maxFailedAttempts],
      ['global failed authentication', this.maxFailedAttemptsGlobal],
      ['authentication failure window', this.failureWindowMs],
      ['authentication cooldown', this.cooldownMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`The Local Session ${name} limit must be a positive safe integer.`)
      }
    }
  }

  private assertNotThrottled(key: string | undefined) {
    const now = this.now()
    if (this.globalFailures?.blockedUntil && this.globalFailures.blockedUntil > now) {
      throw new Error('Local Session authentication is temporarily throttled.')
    }
    if (this.globalFailures && now - this.globalFailures.windowStartedAt >= this.failureWindowMs) {
      this.globalFailures = undefined
    }
    if (!key) return
    const failure = this.failures.get(key)
    if (!failure) return
    if (failure.blockedUntil > now) {
      throw new Error('Local Session profile authentication is temporarily throttled.')
    }
    if (now - failure.windowStartedAt >= this.failureWindowMs) this.failures.delete(key)
  }

  private recordFailure(key: string | undefined) {
    const now = this.now()
    this.globalFailures = nextAuthenticationFailure(
      this.globalFailures,
      now,
      this.failureWindowMs,
      this.cooldownMs,
      this.maxFailedAttemptsGlobal,
    )
    if (!key) return
    const previous = this.failures.get(key)
    if (!previous && this.failures.size >= MAX_TRACKED_AUTHENTICATION_FAILURES) {
      return
    }
    this.failures.set(
      key,
      nextAuthenticationFailure(
        previous,
        now,
        this.failureWindowMs,
        this.cooldownMs,
        this.maxFailedAttempts,
      ),
    )
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted)
      return Promise.reject(new Error('Local Session authentication was aborted.'))
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter: AuthenticationWaiter = {
        signal,
        resolve: () => {
          signal.removeEventListener('abort', waiter.abort)
          this.active += 1
          resolve()
        },
        reject,
        abort: () => {
          const index = this.waiting.indexOf(waiter)
          if (index !== -1) this.waiting.splice(index, 1)
          reject(new Error('Local Session authentication was aborted.'))
        },
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.waiting.push(waiter)
    })
  }

  private release() {
    this.active = Math.max(0, this.active - 1)
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()
      if (!waiter || waiter.signal.aborted) continue
      waiter.resolve()
      return
    }
  }

  async run<T>(input: {
    readonly key?: string
    readonly signal: AbortSignal
    readonly authenticate: () => Promise<T>
  }): Promise<T> {
    this.assertNotThrottled(input.key)
    await this.acquire(input.signal)
    try {
      this.assertNotThrottled(input.key)
      try {
        const result = await input.authenticate()
        if (input.key) this.failures.delete(input.key)
        return result
      } catch (error) {
        if (!input.signal.aborted) this.recordFailure(input.key)
        throw error
      }
    } finally {
      this.release()
    }
  }
}

export function subscriptionLimitReached(
  dependencies: LocalSessionServerDependencies,
  connectionSubscriptions: number,
) {
  const perConnectionLimit =
    dependencies.maxSubscriptionsPerConnection ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION
  const globalLimit = dependencies.maxSubscriptionsGlobal ?? DEFAULT_MAX_SUBSCRIPTIONS_GLOBAL
  return (
    connectionSubscriptions >= perConnectionLimit ||
    dependencies.eventHub.subscriberCount() >= globalLimit
  )
}
