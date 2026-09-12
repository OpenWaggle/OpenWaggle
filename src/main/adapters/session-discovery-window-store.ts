import { randomUUID } from 'node:crypto'
import type {
  SemanticDiscoveryReadiness,
  SessionDiscoveryMode,
  SessionQuerySummary,
} from '@shared/types/session-query'

export const SESSION_DISCOVERY_WINDOW_LIMIT = 500
const SESSION_DISCOVERY_WINDOW_TTL_MS = 5 * 60 * 1000
const MAX_RETAINED_WINDOWS = 256
const MAX_RETAINED_WINDOWS_PER_CALLER = 16

export interface SessionDiscoveryWindowEntry {
  readonly session: SessionQuerySummary
}

export interface SessionDiscoveryWindow {
  readonly id: string
  readonly callerKey: string
  readonly signature: string
  readonly authoritySignature: string
  readonly entries: readonly SessionDiscoveryWindowEntry[]
  readonly truncated: boolean
  readonly modeOutcome: {
    readonly searchBackend: SessionDiscoveryMode
    readonly requestedSearchMode: SessionDiscoveryMode
    readonly semanticReadiness?: SemanticDiscoveryReadiness
    readonly degradation?: {
      readonly from: 'hybrid'
      readonly to: 'lexical'
      readonly reason: string
    }
  }
  readonly createdAt: number
  readonly expiresAt: number
}

export class SessionDiscoveryWindowStore {
  readonly #windows = new Map<string, SessionDiscoveryWindow>()

  create(input: {
    readonly callerKey: string
    readonly signature: string
    readonly authoritySignature: string
    readonly entries: readonly SessionDiscoveryWindowEntry[]
    readonly truncated: boolean
    readonly modeOutcome: SessionDiscoveryWindow['modeOutcome']
    readonly now: number
  }) {
    this.#prune(input.now)
    this.#pruneCaller(input.callerKey)
    const window: SessionDiscoveryWindow = {
      id: randomUUID(),
      callerKey: input.callerKey,
      signature: input.signature,
      authoritySignature: input.authoritySignature,
      entries: input.entries,
      truncated: input.truncated,
      modeOutcome: input.modeOutcome,
      createdAt: input.now,
      expiresAt: input.now + SESSION_DISCOVERY_WINDOW_TTL_MS,
    }
    this.#windows.set(window.id, window)
    this.#prune(input.now)
    return window
  }

  read(input: {
    readonly id: string
    readonly callerKey: string
    readonly signature: string
    readonly authoritySignature: string
    readonly now: number
  }) {
    this.#prune(input.now)
    const window = this.#windows.get(input.id)
    if (!window) return { status: 'expired' as const }
    if (
      window.callerKey !== input.callerKey ||
      window.signature !== input.signature ||
      window.authoritySignature !== input.authoritySignature
    ) {
      return { status: 'mismatch' as const }
    }
    return { status: 'available' as const, window }
  }

  #prune(now: number) {
    for (const [id, window] of this.#windows) {
      if (window.expiresAt <= now) this.#windows.delete(id)
    }
    while (this.#windows.size > MAX_RETAINED_WINDOWS) {
      const oldest = this.#windows.keys().next().value
      if (oldest === undefined) break
      this.#windows.delete(oldest)
    }
  }

  #pruneCaller(callerKey: string) {
    const callerWindows = [...this.#windows.values()].filter(
      (window) => window.callerKey === callerKey,
    )
    const overflow = callerWindows.length - MAX_RETAINED_WINDOWS_PER_CALLER + 1
    if (overflow <= 0) return
    for (const window of callerWindows.slice(0, overflow)) this.#windows.delete(window.id)
  }
}
