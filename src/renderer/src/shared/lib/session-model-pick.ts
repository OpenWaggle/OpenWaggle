import type { SupportedModelId } from '@shared/types/llm'

interface DesiredSessionModelPick {
  readonly generation: number
  readonly model: SupportedModelId
}

/**
 * The newest desired model per session, stamped synchronously when a pick is made. Detail and
 * summary writes flow through {@link reconcileSessionModelPick}, so a refresh that read the row
 * before the pick's write landed cannot clobber the newer choice — whichever store writes, the
 * desired model wins until the pick is cleared.
 */
const desiredBySession = new Map<string, DesiredSessionModelPick>()
let nextGeneration = 0

export function markDesiredSessionModel(sessionId: string, model: SupportedModelId): number {
  const generation = ++nextGeneration
  desiredBySession.set(sessionId, { generation, model })
  return generation
}

/** Clears the guard only when no newer pick has replaced it. */
export function clearDesiredSessionModel(sessionId: string, generation: number): void {
  const current = desiredBySession.get(sessionId)
  if (current?.generation === generation) desiredBySession.delete(sessionId)
}

/** Whether any pick guard is live for the session (a post-materialization pick, for instance). */
export function hasDesiredSessionModel(sessionId: string): boolean {
  return desiredBySession.has(sessionId)
}

interface SessionModelCarrier {
  readonly id: unknown
  readonly selectedModel?: SupportedModelId
}

/** Re-applies the newest desired pick to a row that was read before that pick's write landed. */
export function reconcileSessionModelPick<T extends SessionModelCarrier>(session: T): T {
  const desired = desiredBySession.get(String(session.id))
  if (!desired || session.selectedModel === desired.model) return session
  return { ...session, selectedModel: desired.model }
}

/** One settled model write at a time per session, so overlapping writes reconcile in order. */
const pickQueues = new Map<string, Promise<void>>()

/** Serializes per-session model writes (picker picks and first-send draft flushes alike). */
export async function runExclusiveSessionModelWrite(
  sessionKey: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = pickQueues.get(sessionKey) ?? Promise.resolve()
  const current = previous.then(task, task)
  pickQueues.set(
    sessionKey,
    current.catch(() => undefined),
  )
  await current
}
