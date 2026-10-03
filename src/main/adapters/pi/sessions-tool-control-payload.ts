import { randomUUID } from 'node:crypto'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import { sessionsToolThinkingLevel } from './sessions-tool-thinking'

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

function controlRequest(
  command: SessionControlMutationCommand,
  attachmentPaths?: readonly string[],
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    ...(attachmentPaths?.length ? { transport: { attachmentPaths } } : {}),
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  }
}

function messageInput(input: { readonly text: string; readonly thinking?: string }) {
  const thinkingLevel = sessionsToolThinkingLevel(input.thinking)
  return {
    text: input.text,
    attachmentIds: [],
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
}

/**
 * follow_up, steer, and replace act on an active Run or queue for one, so they never set the
 * Session thinking level or a Run authorization override. The flat provider schema still lists
 * those properties for other actions, so refuse them here with the Host's codes instead of
 * dropping them silently.
 */
function refuseRunSettings(input: object, action: string) {
  if (Reflect.get(input, 'thinking') !== undefined) {
    throw new Error(
      `thinking_level_requires_idle_session: ${action} does not accept thinking. The Session thinking level can change only when no Run is active; pass thinking to message or start on an idle Session.`,
    )
  }
  if (Reflect.get(input, 'authorization') !== undefined) {
    throw new Error(
      `run_authorization_override_requires_idle_session: ${action} does not accept authorization. A Run authorization override applies only to a Run started on an idle Session; pass it to message or start.`,
    )
  }
}

function followUpInput(input: { readonly text: string }) {
  return { text: input.text, attachmentIds: [] }
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
    refuseRunSettings(input, input.action)
    return {
      operation: 'steer',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
      input: followUpInput(input),
    }
  }
  if (input.action === 'replace') {
    refuseRunSettings(input, input.action)
    return {
      operation: 'replace',
      sessionId: input.sessionId,
      expectedRunId: input.expectedRunId,
      input: followUpInput(input),
    }
  }
  if (input.action === 'follow_up') {
    refuseRunSettings(input, input.action)
    return { operation: 'follow-up', sessionId: input.sessionId, input: followUpInput(input) }
  }
  if (input.action === 'message') {
    return {
      operation: 'message',
      sessionId: input.sessionId,
      ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
      input: messageInput(input),
    }
  }
  return {
    operation: 'start',
    sessionId: input.sessionId,
    ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
    ...(input.interactionTimeoutMs !== undefined
      ? { interactionTimeoutMs: input.interactionTimeoutMs }
      : {}),
    input: messageInput(input),
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
  return controlRequest(
    runControlCommand(input),
    'attachmentPaths' in input ? input.attachmentPaths : undefined,
  )
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
