import { randomUUID } from 'node:crypto'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionsToolParameters } from './sessions-tool-parameters'

export type SessionsToolControlInput = Extract<
  SessionsToolParameters,
  {
    action:
      | 'message'
      | 'start'
      | 'follow_up'
      | 'steer'
      | 'replace'
      | 'promote'
      | 'interrupt'
      | 'interrupt_descendants'
      | 'request_respond'
      | 'approval_respond'
      | 'authorization_set'
  }
>

function controlRequest(command: SessionControlMutationCommand): LocalSessionCommandPayload {
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

function runControlCommand(
  input: Extract<
    SessionsToolControlInput,
    { action: 'message' | 'start' | 'follow_up' | 'steer' | 'replace' | 'promote' }
  >,
): SessionControlMutationCommand {
  if (input.action === 'promote') {
    return {
      operation: 'promote',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
      followUpId: input.followUpId,
    }
  }
  if (input.action === 'steer') {
    return {
      operation: 'steer',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
      input: { text: input.text, attachmentIds: [] },
    }
  }
  if (input.action === 'replace') {
    return {
      operation: 'replace',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
      ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
      input: { text: input.text, attachmentIds: [] },
    }
  }
  if (input.action === 'message') {
    return {
      operation: 'message',
      sessionId: input.sessionId,
      input: { text: input.text, attachmentIds: [] },
    }
  }
  if (input.action === 'follow_up') {
    return {
      operation: 'follow-up',
      sessionId: input.sessionId,
      ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
      input: { text: input.text, attachmentIds: [] },
    }
  }
  return {
    operation: 'start',
    sessionId: input.sessionId,
    ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
    ...(input.interactionTimeoutMs !== undefined
      ? { interactionTimeoutMs: input.interactionTimeoutMs }
      : {}),
    input: { text: input.text, attachmentIds: [] },
  }
}

function isRunControlInput(
  input: SessionsToolControlInput,
): input is Extract<
  SessionsToolControlInput,
  { action: 'message' | 'start' | 'follow_up' | 'steer' | 'replace' | 'promote' }
> {
  return new Set(['message', 'start', 'follow_up', 'steer', 'replace', 'promote']).has(input.action)
}

export function buildSessionsToolControlPayload(
  input: SessionsToolControlInput,
): LocalSessionCommandPayload {
  if (input.action === 'interrupt') {
    return controlRequest({
      operation: 'interrupt',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
    })
  }
  if (input.action === 'interrupt_descendants') {
    return controlRequest({ operation: 'interrupt-descendants', sessionId: input.sessionId })
  }
  if (input.action === 'request_respond' || input.action === 'approval_respond') {
    const response = decodeUnknownExactOrThrow(agentLoopResponseSchema, input.response)
    return controlRequest({
      operation: input.action === 'approval_respond' ? 'approval-respond' : 'request-respond',
      sessionId: input.sessionId,
      runId: input.runId,
      interactionId: input.interactionId,
      kind: response.kind,
      response,
    })
  }
  if (input.action === 'authorization_set') {
    return controlRequest({
      operation: 'authorization-set',
      sessionId: input.sessionId,
      authorizationMode: input.authorizationMode === 'inherit' ? null : input.authorizationMode,
    })
  }
  if (!isRunControlInput(input)) throw new Error('Unsupported Sessions control action.')
  return controlRequest(runControlCommand(input))
}

export function isSessionsToolControlAction(
  input: SessionsToolParameters,
): input is SessionsToolControlInput {
  return new Set([
    'message',
    'start',
    'follow_up',
    'steer',
    'replace',
    'promote',
    'interrupt',
    'interrupt_descendants',
    'request_respond',
    'approval_respond',
    'authorization_set',
  ]).has(input.action)
}
