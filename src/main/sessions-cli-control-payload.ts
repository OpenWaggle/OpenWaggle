import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import {
  nonNegativeInteger,
  positiveInteger,
  required,
  runAuthorization,
  thinkingLevel,
} from './sessions-cli-arguments'
import { delegationCommand } from './sessions-cli-delegation-command'

const QUEUE_ITEM_POSITIONAL_START = 2
const AUTHORIZATION_MODE_POSITIONAL = 2

function messageInput(text: string, arguments_: ParsedArguments) {
  const resolvedThinkingLevel = thinkingLevel(option(arguments_, 'thinking'))
  return {
    text,
    attachmentIds: [],
    ...(resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {}),
  }
}

function organizationCommand(
  command: string,
  arguments_: ParsedArguments,
): SessionOrganizationCommand | undefined {
  if (
    command !== 'rename' &&
    command !== 'archive' &&
    command !== 'unarchive' &&
    command !== 'handoff'
  )
    return undefined
  const sessionId = required(arguments_.positionals[0], 'Session ID')
  if (command === 'handoff') {
    const mode = required(option(arguments_, 'workspace'), '--workspace')
    if (mode === 'local') return { operation: command, sessionId, workspace: { mode } }
    if (mode === 'existing') {
      return {
        operation: command,
        sessionId,
        workspace: {
          mode,
          workspaceId: required(option(arguments_, 'workspace-id'), '--workspace-id'),
        },
      }
    }
    if (mode === 'new-worktree') {
      return {
        operation: command,
        sessionId,
        workspace: {
          mode,
          ...(option(arguments_, 'base-ref') ? { baseRef: option(arguments_, 'base-ref') } : {}),
          ...(hasFlag(arguments_, 'start-from-origin') ? { startFromOrigin: true } : {}),
        },
      }
    }
    throw new Error('Handoff --workspace must be local, existing, or new-worktree.')
  }
  return command === 'rename'
    ? {
        operation: command,
        sessionId,
        title: required(arguments_.positionals.slice(1).join(' '), 'Title'),
      }
    : { operation: command, sessionId }
}

function controlCommand(
  command: string,
  arguments_: ParsedArguments,
): SessionControlMutationCommand {
  const organization = organizationCommand(command, arguments_)
  if (organization) return organization
  const sessionId = required(arguments_.positionals[0], 'Session ID')
  if (command === 'report') return reportCommand(sessionId, arguments_)
  if (command === 'interrupt-descendants') return { operation: command, sessionId }
  if (command === 'interrupt') {
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
    }
  }
  if (command === 'promote') {
    return {
      operation: command,
      sessionId,
      followUpId: required(arguments_.positionals[1], 'Follow-up ID'),
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
    }
  }
  return messagingCommand(command, sessionId, arguments_)
}

function messagingCommand(
  command: string,
  sessionId: string,
  arguments_: ParsedArguments,
): SessionControlMutationCommand {
  const text = required(option(arguments_, 'text'), 'Message input')
  if (command === 'steer') {
    if (hasFlag(arguments_, 'yolo') || option(arguments_, 'authorization')) {
      throw new Error('Steer does not accept Run authorization; use replace to start a new Run.')
    }
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
      input: { text, attachmentIds: [] },
    }
  }
  if (command === 'replace') {
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
      ...(runAuthorization(arguments_)
        ? { runAuthorizationOverride: runAuthorization(arguments_) }
        : {}),
      input: messageInput(text, arguments_),
    }
  }
  if (command === 'start' || command === 'follow-up') {
    return {
      operation: command,
      sessionId,
      ...(runAuthorization(arguments_)
        ? { runAuthorizationOverride: runAuthorization(arguments_) }
        : {}),
      ...(command === 'start' && option(arguments_, 'interaction-timeout-ms') !== undefined
        ? {
            interactionTimeoutMs: positiveInteger(
              option(arguments_, 'interaction-timeout-ms'),
              '--interaction-timeout-ms',
            ),
          }
        : {}),
      input: messageInput(text, arguments_),
    }
  }
  if (command === 'message') {
    if (hasFlag(arguments_, 'yolo') || option(arguments_, 'authorization')) {
      throw new Error(
        'Adaptive message does not accept Run authorization; use start or follow-up explicitly.',
      )
    }
    return { operation: command, sessionId, input: messageInput(text, arguments_) }
  }
  throw new Error(`Unsupported messaging command: ${command}.`)
}

function authorizationCommand(arguments_: ParsedArguments): SessionControlMutationCommand {
  const action = required(arguments_.positionals[0], 'Authorization action')
  const sessionId = required(arguments_.positionals[1], 'Session ID')
  if (action === 'clear') {
    return { operation: 'authorization-set', sessionId, authorizationMode: null }
  }
  if (action !== 'set') throw new Error(`Unsupported Authorization action: ${action}.`)
  const mode = required(arguments_.positionals[AUTHORIZATION_MODE_POSITIONAL], 'Authorization mode')
  if (mode !== 'ask-for-approval' && mode !== 'yolo') {
    throw new Error('Authorization mode must be ask-for-approval or yolo.')
  }
  return {
    operation: 'authorization-set',
    sessionId,
    authorizationMode: mode,
  }
}

function reportTarget(arguments_: ParsedArguments) {
  const explicitTargets = arguments_.options.get('target') ?? []
  const worker = option(arguments_, 'worker')
  const selected = [
    ...(hasFlag(arguments_, 'upstream') ? ['upstream'] : []),
    ...(hasFlag(arguments_, 'queen') ? ['queen'] : []),
    ...(explicitTargets.length > 0 ? ['target'] : []),
    ...(worker ? ['worker'] : []),
  ]
  if (selected.length !== 1) {
    throw new Error('Report requires exactly one of --upstream, --queen, --target, or --worker.')
  }
  if (selected[0] === 'upstream') return { type: 'upstream' as const }
  if (selected[0] === 'queen') return { type: 'queen' as const }
  if (selected[0] === 'worker') {
    return { type: 'worker-reference' as const, reference: required(worker, '--worker') }
  }
  return explicitTargets.length === 1
    ? { type: 'session' as const, sessionId: explicitTargets[0] ?? '' }
    : { type: 'sessions' as const, sessionIds: explicitTargets }
}

function reportCommand(
  sessionId: string,
  arguments_: ParsedArguments,
): SessionControlMutationCommand {
  return {
    operation: 'report',
    sessionId,
    ...(option(arguments_, 'source-run') ? { sourceRunId: option(arguments_, 'source-run') } : {}),
    target: reportTarget(arguments_),
    input: {
      text: required(option(arguments_, 'text'), 'Report input'),
      requestReply: hasFlag(arguments_, 'request-reply'),
      ...(option(arguments_, 'reply-to')
        ? { replyToReportId: option(arguments_, 'reply-to') }
        : {}),
    },
  }
}

function queueCommand(arguments_: ParsedArguments): SessionControlMutationCommand {
  const action = required(arguments_.positionals[0], 'Queue action')
  const sessionId = required(arguments_.positionals[1], 'Session ID')
  if (action === 'withdraw') {
    return {
      operation: 'queue-withdraw',
      sessionId,
      followUpIds: arguments_.positionals.slice(QUEUE_ITEM_POSITIONAL_START),
    }
  }
  if (action === 'update-authorization') {
    const authorization = required(option(arguments_, 'authorization'), '--authorization')
    if (
      authorization !== 'inherit' &&
      authorization !== 'ask-for-approval' &&
      authorization !== 'yolo'
    ) {
      throw new Error('--authorization must be inherit, ask-for-approval, or yolo.')
    }
    return {
      operation: 'queue-update-authorization',
      sessionId,
      followUpId: required(arguments_.positionals[QUEUE_ITEM_POSITIONAL_START], 'Follow-up ID'),
      runAuthorizationOverride: authorization === 'inherit' ? null : authorization,
    }
  }
  const expectedQueueRevision = nonNegativeInteger(
    option(arguments_, 'queue-revision'),
    '--queue-revision',
  )
  if (action === 'reorder') {
    return {
      operation: 'queue-reorder',
      sessionId,
      expectedQueueRevision,
      orderedFollowUpIds: arguments_.positionals.slice(QUEUE_ITEM_POSITIONAL_START),
    }
  }
  if (action === 'pause' || action === 'resume') {
    return {
      operation: action === 'pause' ? 'queue-pause' : 'queue-resume',
      sessionId,
      expectedQueueRevision,
    }
  }
  throw new Error(`Unsupported queue action: ${action}.`)
}

export function buildSessionsCliControlPayload(
  command: string,
  arguments_: ParsedArguments,
): LocalSessionCommandPayload {
  const attachmentPaths = arguments_.options.get('attach') ?? []
  if (
    attachmentPaths.length > 0 &&
    command !== 'message' &&
    command !== 'start' &&
    command !== 'follow-up' &&
    command !== 'steer' &&
    command !== 'replace'
  ) {
    throw new Error(`${command} does not accept --attach.`)
  }
  return {
    contract: 'session-control-v2',
    ...(attachmentPaths.length > 0 ? { transport: { attachmentPaths } } : {}),
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: option(arguments_, 'idempotency-key') ?? randomUUID(),
      command:
        command === 'authorization'
          ? authorizationCommand(arguments_)
          : command === 'queue'
            ? queueCommand(arguments_)
            : command === 'delegation'
              ? delegationCommand(arguments_)
              : controlCommand(command, arguments_),
    },
  }
}
