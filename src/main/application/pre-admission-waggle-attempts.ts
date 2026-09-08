import type { SessionId } from '@shared/types/brand'

const preAdmissionWaggleAttempts = new Map<SessionId, Set<AbortController>>()

export function registerPreAdmissionWaggleAttempt(
  sessionId: SessionId,
  controller: AbortController,
) {
  const attempts = preAdmissionWaggleAttempts.get(sessionId) ?? new Set<AbortController>()
  attempts.add(controller)
  preAdmissionWaggleAttempts.set(sessionId, attempts)
  let released = false
  return () => {
    if (released) return
    released = true
    attempts.delete(controller)
    if (attempts.size === 0 && preAdmissionWaggleAttempts.get(sessionId) === attempts) {
      preAdmissionWaggleAttempts.delete(sessionId)
    }
  }
}

export function requestPreAdmissionWaggleInterruptions(sessionId: SessionId) {
  const attempts = preAdmissionWaggleAttempts.get(sessionId)
  if (!attempts || attempts.size === 0) return false
  for (const controller of attempts) controller.abort()
  return true
}

export function requestAllPreAdmissionWaggleInterruptions() {
  for (const attempts of preAdmissionWaggleAttempts.values()) {
    for (const controller of attempts) controller.abort()
  }
}

export function preAdmissionWaggleSessionIds() {
  return preAdmissionWaggleAttempts.keys()
}
