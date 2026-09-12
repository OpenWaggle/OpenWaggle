import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { SessionsToolParameters } from './sessions-tool-parameters'

type OrganizationInput = Extract<
  SessionsToolParameters,
  { action: 'rename' | 'archive' | 'unarchive' | 'handoff' }
>

export function isSessionsToolOrganization(
  input: SessionsToolParameters,
): input is OrganizationInput {
  return (
    input.action === 'rename' ||
    input.action === 'archive' ||
    input.action === 'unarchive' ||
    input.action === 'handoff'
  )
}

export function buildSessionsToolOrganizationPayload(
  input: OrganizationInput,
): LocalSessionCommandPayload {
  const command = (() => {
    if (input.action === 'rename') {
      return { operation: input.action, sessionId: input.sessionId, title: input.title }
    }
    if (input.action !== 'handoff') return { operation: input.action, sessionId: input.sessionId }
    if (input.workspace === 'existing') {
      if (!input.workspaceId) throw new Error('sessions handoff existing requires workspaceId.')
      return {
        operation: input.action,
        sessionId: input.sessionId,
        workspace: { mode: input.workspace, workspaceId: input.workspaceId },
      }
    }
    return {
      operation: input.action,
      sessionId: input.sessionId,
      workspace:
        input.workspace === 'new-worktree'
          ? {
              mode: input.workspace,
              ...(input.baseRef ? { baseRef: input.baseRef } : {}),
              ...(input.startFromOrigin === undefined
                ? {}
                : { startFromOrigin: input.startFromOrigin }),
            }
          : { mode: input.workspace },
    }
  })()
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  }
}
