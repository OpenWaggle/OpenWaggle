import type { AgentSession, PrecomputedCompaction } from '@earendil-works/pi-coding-agent'

/**
 * Idle compaction (ADR 0025, amended). A Session left idle with a large context loses its prompt
 * cache after five minutes, and the next message rewrites the whole context to the cache at the
 * write price. Shortly before the entry expires, OpenWaggle asks the model for the Portable
 * handoff with the Session's own last request, a cache read, and keeps it. A Run that starts
 * after the entry expired installs it before its first request; a Run that starts sooner drops
 * it, because the full context is still cheap to read.
 */

/** Smaller contexts are cheap enough to rewrite. */
export const IDLE_COMPACTION_MIN_CONTEXT_TOKENS = 200_000

/** How long before the cache entry expires the handoff is requested. */
export const IDLE_COMPACTION_LEAD_MS = 60_000

export interface IdleCompactionPlan {
  /** When to request the handoff. */
  readonly dueAt: number
  /** The request's cache lifetime; the handoff request refreshes the entry for this long. */
  readonly ttlMs: number
}

/** When to compact the Session `session` ran for, or undefined when it should not be. */
export function planIdleCompaction(
  session: AgentSession,
  now: number,
): IdleCompactionPlan | undefined {
  const candidate = session.idleCompactionCandidate
  if (!candidate || candidate.promptTokens < IDLE_COMPACTION_MIN_CONTEXT_TOKENS) return undefined
  const dueAt = candidate.sentAt + candidate.ttlMs - IDLE_COMPACTION_LEAD_MS
  // Too late to read the entry before it expires.
  if (dueAt <= now) return undefined
  return { dueAt, ttlMs: candidate.ttlMs }
}

export interface PendingIdleCompaction {
  readonly compaction: PrecomputedCompaction
  /** Until then the full context is still cached, and the handoff is not worth installing. */
  readonly cacheExpiresAt: number
}

/** The handoff to install for a Run starting at `now`, if the cache it replaces has expired. */
export function idleCompactionToInstall(
  pending: PendingIdleCompaction | undefined,
  now: number,
): PrecomputedCompaction | undefined {
  return pending && now >= pending.cacheExpiresAt ? pending.compaction : undefined
}
