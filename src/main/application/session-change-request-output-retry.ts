import type { SessionId } from '@shared/types/brand'
import type { RecordSessionChangeRequestInput } from '@shared/types/session-resource'

const pendingChangeRequestOutputs = new Set<string>()
const pendingCommitOutputs = new Map<SessionId, Map<string, PendingCommitOutput>>()

export interface PendingCommitOutput {
  readonly commitHash: string
  readonly summary: string
}

function retryKey(sessionId: SessionId, input: RecordSessionChangeRequestInput) {
  return JSON.stringify([sessionId, input.title, input.url])
}

export function registerPendingChangeRequestOutput(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
) {
  pendingChangeRequestOutputs.add(retryKey(sessionId, input))
}

export function isPendingChangeRequestOutput(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
) {
  return pendingChangeRequestOutputs.has(retryKey(sessionId, input))
}

export function clearPendingChangeRequestOutput(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
) {
  pendingChangeRequestOutputs.delete(retryKey(sessionId, input))
}

export function clearPendingChangeRequestOutputsForTests() {
  pendingChangeRequestOutputs.clear()
  pendingCommitOutputs.clear()
}

export function registerPendingCommitOutput(sessionId: SessionId, input: PendingCommitOutput) {
  const sessionOutputs =
    pendingCommitOutputs.get(sessionId) ?? new Map<string, PendingCommitOutput>()
  sessionOutputs.set(input.commitHash, input)
  pendingCommitOutputs.set(sessionId, sessionOutputs)
}

export function listPendingCommitOutputs(sessionId: SessionId) {
  return [...(pendingCommitOutputs.get(sessionId)?.values() ?? [])]
}

export function clearPendingCommitOutput(sessionId: SessionId, commitHash: string) {
  const sessionOutputs = pendingCommitOutputs.get(sessionId)
  if (!sessionOutputs) return
  sessionOutputs.delete(commitHash)
  if (sessionOutputs.size === 0) pendingCommitOutputs.delete(sessionId)
}
