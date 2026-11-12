import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import { sessionIdFromReference, sessionIdsFromReferences } from '@shared/utils/session-link'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import {
  nonNegativeInteger,
  positiveInteger,
  refuseRunSettingsOnActiveRunCommand,
  required,
  requiredSessionId,
  runAuthorization,
  thinkingLevel,
  optionEntry,
} from './sessions-cli-arguments'
import { delegationCommand } from './sessions-cli-delegation-command'
import type { SessionsCliStructuredInput } from './sessions-cli-delegation-input'

const QUEUE_ITEM_POSITIONAL_START = 1
const AUTHORIZATION_MODE_POSITIONAL = 1

function messageInput(text: string, arguments_: ParsedArguments) {
  const resolvedThinkingLevel = thinkingLevel(option(arguments_, 'thinking'))
  return {
    text,
    attachmentIds: [],
    ...(resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {}),
  }
}

/** A message for a Run that is active or queued: no thinking level (see the option contract). */
function followUpInput(text: string) {
  return { text, attachmentIds: [] }
}

function organizationCommand(command: string, arguments_: ParsedArguments) {
  if (
    command !== 'rename' &&
    command !== 'archive' &&
    command !== 'unarchive' &&
    command !== 'handoff'
  ) {
    return undefined
  }
  const sessionId = requiredSessionId(arguments_.positionals[0])
  if (command === 'handoff') {
    const mode = required(option(arguments_, 'workspace'), '--workspace')
    if (mode === 'local') {
      return {
        operation: command,
        sessionId,
        workspace: { mode },
      } satisfies SessionOrganizationCommand
    }
    if (mode === 'existing') {
      return {
        operation: command,
        sessionId,
        workspace: {
          mode,
          workspaceId: required(option(arguments_, 'workspace-id'), '--workspace-id'),
        },
      } satisfies SessionOrganizationCommand
    }
    if (mode === 'new-worktree') {
      return {
        operation: command,
        sessionId,
        workspace: {
          mode,
          ...optionEntry(arguments_, 'base-ref', 'baseRef'),
          ...(hasFlag(arguments_, 'start-from-origin') ? { startFromOrigin: true } : {}),
        },
      } satisfies SessionOrganizationCommand
    }
    throw new Error('Handoff --workspace must be local, existing, or new-worktree.')
  }
  const result: SessionOrganizationCommand | undefined =
    command === 'rename'
      ? {
          operation: command,
          sessionId,
          title: required(arguments_.positionals.slice(1).join(' '), 'Title'),
        }
      : { operation: command, sessionId }
  return result
}

function controlCommand(command: string, arguments_: ParsedArguments) {
  const organization = organizationCommand(command, arguments_)
  if (organization) return organization
  const sessionId = requiredSessionId(arguments_.positionals[0])
  if (command === 'report') return reportCommand(sessionId, arguments_)
  if (command === 'interrupt-descendants') {
    return { operation: command, sessionId } satisfies SessionControlMutationCommand
  }
  if (command === 'interrupt') {
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
    } satisfies SessionControlMutationCommand
  }
  if (command === 'promote') {
    return {
      operation: command,
      sessionId,
      followUpId: required(arguments_.positionals[1], 'Follow-up ID'),
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
    } satisfies SessionControlMutationCommand
  }
  const result: SessionControlMutationCommand = messagingCommand(command, sessionId, arguments_)
  return result
}

function messagingCommand(command: string, sessionId: string, arguments_: ParsedArguments) {
  const text = required(option(arguments_, 'text'), 'Message input')
  refuseRunSettingsOnActiveRunCommand(command, arguments_)
  if (command === 'steer') {
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
      input: followUpInput(text),
    } satisfies SessionControlMutationCommand
  }
  if (command === 'replace') {
    return {
      operation: command,
      sessionId,
      expectedRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
      input: followUpInput(text),
    } satisfies SessionControlMutationCommand
  }
  if (command === 'follow-up') {
    return {
      operation: command,
      sessionId,
      input: followUpInput(text),
    } satisfies SessionControlMutationCommand
  }
  if (command === 'start' || command === 'message') {
    const runAuthorizationOverride = runAuthorization(arguments_)
    return {
      operation: command,
      sessionId,
      ...(runAuthorizationOverride ? { runAuthorizationOverride } : {}),
      ...(command === 'start' && option(arguments_, 'interaction-timeout-ms') !== undefined
        ? {
            interactionTimeoutMs: positiveInteger(
              option(arguments_, 'interaction-timeout-ms'),
              '--interaction-timeout-ms',
            ),
          }
        : {}),
      input: messageInput(text, arguments_),
    } satisfies SessionControlMutationCommand
  }
  throw new Error(`Unsupported messaging command: ${command}.`)
}

/** `hive authorization-set <session> inherit` clears the override, as the tool's `inherit` does. */
function authorizationCommand(arguments_: ParsedArguments) {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const mode = required(arguments_.positionals[AUTHORIZATION_MODE_POSITIONAL], 'Authorization mode')
  if (mode === 'inherit') {
    return {
      operation: 'authorization-set',
      sessionId,
      authorizationMode: null,
    } satisfies SessionControlMutationCommand
  }
  if (mode !== 'ask-for-approval' && mode !== 'yolo') {
    throw new Error('Authorization mode must be inherit, ask-for-approval, or yolo.')
  }
  const command: SessionControlMutationCommand = {
    operation: 'authorization-set',
    sessionId,
    authorizationMode: mode,
  }
  return command
}

function reportTarget(arguments_: ParsedArguments) {
  const explicitTargets = sessionIdsFromReferences(
    arguments_.options.get('target') ?? [],
    '--target',
  )
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
    // A Worker reference may be a Session id, so a link resolves the same way (ADR 0056).
    return {
      type: 'worker-reference' as const,
      reference: sessionIdFromReference(required(worker, '--worker'), '--worker'),
    }
  }
  return explicitTargets.length === 1
    ? { type: 'session' as const, sessionId: explicitTargets[0] ?? '' }
    : { type: 'sessions' as const, sessionIds: explicitTargets }
}

function reportCommand(sessionId: string, arguments_: ParsedArguments) {
  return {
    operation: 'report',
    sessionId,
    ...optionEntry(arguments_, 'source-run', 'sourceRunId'),
    target: reportTarget(arguments_),
    input: {
      text: required(option(arguments_, 'text'), 'Report input'),
      requestReply: hasFlag(arguments_, 'request-reply'),
      ...optionEntry(arguments_, 'reply-to', 'replyToReportId'),
    },
  } satisfies SessionControlMutationCommand
}

function queueCommand(command: string, arguments_: ParsedArguments) {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  if (command === 'queue-withdraw') {
    return {
      operation: 'queue-withdraw',
      sessionId,
      followUpIds: arguments_.positionals.slice(QUEUE_ITEM_POSITIONAL_START),
    } satisfies SessionControlMutationCommand
  }
  const expectedQueueRevision = nonNegativeInteger(
    option(arguments_, 'queue-revision'),
    '--queue-revision',
  )
  if (command === 'queue-reorder') {
    return {
      operation: 'queue-reorder',
      sessionId,
      expectedQueueRevision,
      orderedFollowUpIds: arguments_.positionals.slice(QUEUE_ITEM_POSITIONAL_START),
    } satisfies SessionControlMutationCommand
  }
  if (command === 'queue-pause' || command === 'queue-resume') {
    return {
      operation: command,
      sessionId,
      expectedQueueRevision,
    } satisfies SessionControlMutationCommand
  }
  throw new Error(`Unsupported queue command: ${command}.`)
}

export function buildSessionsCliControlPayload(
  command: string,
  arguments_: ParsedArguments,
  structured: SessionsCliStructuredInput = {},
) {
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
        command === 'authorization-set'
          ? authorizationCommand(arguments_)
          : command.startsWith('queue-')
            ? queueCommand(command, arguments_)
            : command.startsWith('delegation-')
              ? delegationCommand(command, arguments_, structured)
              : controlCommand(command, arguments_),
    },
  } satisfies LocalSessionCommandPayload
}
