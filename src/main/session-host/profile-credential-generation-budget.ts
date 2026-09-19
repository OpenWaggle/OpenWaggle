const DEFAULT_MAX_CONCURRENT = 2
const DEFAULT_MAX_PENDING = 16
const DEFAULT_MAX_NAMED_PROFILE_STARTS_PER_WINDOW = 4
const DEFAULT_WINDOW_MS = 30_000
const MAX_TRACKED_NAMED_PROFILES = 1024

export class ProfileCredentialGenerationRateLimitError extends Error {
  readonly code = 'profile_credential_rate_limited'
  readonly retryable = true
}

interface PendingGeneration {
  readonly task: () => Promise<string>
  readonly resolve: (value: string) => void
  readonly reject: (cause: unknown) => void
}

export interface ProfileCredentialGenerationBudgetOptions {
  readonly maxConcurrent?: number
  readonly maxPending?: number
  readonly maxNamedProfileStartsPerWindow?: number
  readonly windowMs?: number
  readonly now?: () => number
}

export class ProfileCredentialGenerationBudget {
  private readonly maxConcurrent: number
  private readonly maxPending: number
  private readonly maxNamedProfileStartsPerWindow: number
  private readonly windowMs: number
  private readonly now: () => number
  private active = 0
  private readonly pending: PendingGeneration[] = []
  private readonly inFlight = new Map<string, Promise<string>>()
  private readonly namedProfileStarts = new Map<string, number[]>()

  constructor(options: ProfileCredentialGenerationBudgetOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING
    this.maxNamedProfileStartsPerWindow =
      options.maxNamedProfileStartsPerWindow ?? DEFAULT_MAX_NAMED_PROFILE_STARTS_PER_WINDOW
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
    this.now = options.now ?? Date.now
    for (const value of [
      this.maxConcurrent,
      this.maxPending,
      this.maxNamedProfileStartsPerWindow,
      this.windowMs,
    ]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('Profile credential generation limits must be positive safe integers.')
      }
    }
  }

  private admitNamedProfile(callerId: string) {
    if (!callerId.startsWith('profile:')) return
    const now = this.now()
    for (const [trackedCallerId, trackedStarts] of this.namedProfileStarts) {
      if (trackedStarts.every((startedAt) => now - startedAt >= this.windowMs)) {
        this.namedProfileStarts.delete(trackedCallerId)
      }
    }
    if (
      !this.namedProfileStarts.has(callerId) &&
      this.namedProfileStarts.size >= MAX_TRACKED_NAMED_PROFILES
    ) {
      throw new ProfileCredentialGenerationRateLimitError(
        'Profile credential generation tracking capacity is temporarily full.',
      )
    }
    const starts = (this.namedProfileStarts.get(callerId) ?? []).filter(
      (startedAt) => now - startedAt < this.windowMs,
    )
    if (starts.length >= this.maxNamedProfileStartsPerWindow) {
      throw new ProfileCredentialGenerationRateLimitError(
        'Profile credential generation is temporarily rate limited.',
      )
    }
    starts.push(now)
    this.namedProfileStarts.set(callerId, starts)
  }

  private startNext() {
    while (this.active < this.maxConcurrent) {
      const next = this.pending.shift()
      if (!next) return
      this.active += 1
      void Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active = Math.max(0, this.active - 1)
          this.startNext()
        })
    }
  }

  private schedule(task: () => Promise<string>) {
    if (this.active >= this.maxConcurrent && this.pending.length >= this.maxPending) {
      return Promise.reject(
        new ProfileCredentialGenerationRateLimitError(
          'Profile credential generation capacity is temporarily full.',
        ),
      )
    }
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ task, resolve, reject })
      this.startNext()
    })
  }

  run(input: {
    readonly callerId: string
    readonly operationKey: string
    readonly task: () => Promise<string>
  }): Promise<string> {
    const key = `${input.callerId}\0${input.operationKey}`
    const existing = this.inFlight.get(key)
    if (existing) return existing
    if (this.active >= this.maxConcurrent && this.pending.length >= this.maxPending) {
      return Promise.reject(
        new ProfileCredentialGenerationRateLimitError(
          'Profile credential generation capacity is temporarily full.',
        ),
      )
    }
    try {
      this.admitNamedProfile(input.callerId)
    } catch (cause) {
      return Promise.reject(cause)
    }
    const operation = this.schedule(input.task)
    this.inFlight.set(key, operation)
    void operation.finally(() => this.inFlight.delete(key)).catch(() => undefined)
    return operation
  }
}

export const profileCredentialGenerationBudget = new ProfileCredentialGenerationBudget()
