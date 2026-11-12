import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import {
  type AgentAuthorizationScopeKey,
  isAgentAuthorizationCapability,
} from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopConfirmPurpose,
  AgentLoopCustomInteraction,
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteractionBase,
  AgentLoopInteractionKind,
  AgentLoopInteractionStatus,
  AgentLoopNotifyInteraction,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type {
  AgentTransportErrorInfo,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import { uncheckedFields } from '@shared/utils/object-shape'
import { numberOrNull, optionalJsonValue, stringOrNull } from './agent-loop-transcript-event-fields'

type AgentLoopInteractionBaseFields = Omit<AgentLoopInteractionBase, 'kind'>

function baseInteractionFields(interaction: unknown): AgentLoopInteractionBaseFields | null {
  const fields = uncheckedFields<AgentLoopInteractionBase>(interaction)
  const interactionId = stringOrNull(fields.interactionId)
  const sessionId = stringOrNull(fields.sessionId)
  const runId = stringOrNull(fields.runId)
  const source = stringOrNull(fields.source)
  const createdAt = numberOrNull(fields.createdAt)

  if (
    interactionId === null ||
    sessionId === null ||
    runId === null ||
    source !== 'pi-ui' ||
    createdAt === null
  ) {
    return null
  }

  const base: AgentLoopInteractionBaseFields = {
    interactionId,
    sessionId: SessionId(sessionId),
    runId,
    source: 'pi-ui',
    createdAt,
  }
  const timeoutMs = numberOrNull(fields.timeoutMs)
  return timeoutMs !== null ? { ...base, timeoutMs } : base
}

function parseChoices(value: unknown) {
  return Array.isArray(value) && value.every((choice) => typeof choice === 'string') ? value : null
}

/**
 * Rehydrates a confirm from persisted history.
 *
 * An unrecognised or missing purpose becomes `user-input`, the purpose nothing may answer on the
 * user's behalf. Replayed history must never widen into `authorization`.
 */
function parseConfirmPurpose(value: string | null): AgentLoopConfirmPurpose {
  if (
    value === 'authorization' ||
    value === 'user-input' ||
    value === 'disclosure' ||
    value === 'external-navigation'
  ) {
    return value
  }
  return 'user-input'
}

/**
 * Rehydrates the grant key from persisted history.
 *
 * Without this a request replayed after a reload kept its `authorization` purpose but lost its key,
 * so it no longer counted as an authorization request: the ribbon degraded to a plain question with
 * no scope choices, and the user could not keep an approval they had been offered before.
 *
 * The capability is validated rather than trusted. An unknown capability from a newer build yields no
 * key, which degrades to a prompt with no scope choices instead of inventing a key that would match
 * the wrong thing.
 */
function parseScopeKey(value: unknown): AgentAuthorizationScopeKey | null {
  const fields = uncheckedFields<AgentAuthorizationScopeKey>(value)
  const requester = stringOrNull(fields.requester)
  const requesterId = stringOrNull(fields.requesterId)
  if (requester === null || requesterId === null) return null
  const capability = stringOrNull(fields.capability)
  if (!isAgentAuthorizationCapability(capability)) return null

  const resource = stringOrNull(fields.resource)
  return { capability, requester, requesterId, ...(resource === null ? {} : { resource }) }
}

function parseConfirmInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopConfirmInteraction | null {
  const fields = uncheckedFields<AgentLoopConfirmInteraction>(interaction)
  const title = stringOrNull(fields.title)
  const message = stringOrNull(fields.message)
  if (title === null || message === null) return null

  const scopeKey = parseScopeKey(fields.scopeKey)
  return {
    ...base,
    kind: 'confirm',
    title,
    message,
    purpose: parseConfirmPurpose(stringOrNull(fields.purpose)),
    ...(scopeKey === null ? {} : { scopeKey }),
  }
}

function parseSelectInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopSelectInteraction | null {
  const fields = uncheckedFields<AgentLoopSelectInteraction>(interaction)
  const title = stringOrNull(fields.title)
  const choices = parseChoices(fields.choices)
  return title !== null && choices !== null ? { ...base, kind: 'select', title, choices } : null
}

function parseInputInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopInputInteraction | null {
  const fields = uncheckedFields<AgentLoopInputInteraction>(interaction)
  const title = stringOrNull(fields.title)
  const placeholder = stringOrNull(fields.placeholder)
  return title !== null
    ? { ...base, kind: 'input', title, ...(placeholder !== null ? { placeholder } : {}) }
    : null
}

function parseEditorInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopEditorInteraction | null {
  const fields = uncheckedFields<AgentLoopEditorInteraction>(interaction)
  const title = stringOrNull(fields.title)
  const prefill = stringOrNull(fields.prefill)
  return title !== null
    ? { ...base, kind: 'editor', title, ...(prefill !== null ? { prefill } : {}) }
    : null
}

function parseNotifyInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopNotifyInteraction | null {
  const fields = uncheckedFields<AgentLoopNotifyInteraction>(interaction)
  const message = stringOrNull(fields.message)
  const level = stringOrNull(fields.level)
  if (message === null || (level !== 'info' && level !== 'warning' && level !== 'error')) {
    return null
  }
  return { ...base, kind: 'notify', message, level }
}

function parseCustomInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: unknown,
): AgentLoopCustomInteraction | null {
  const fields = uncheckedFields<AgentLoopCustomInteraction>(interaction)
  const customType =
    stringOrNull(fields.customType) ?? OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE
  const payload = optionalJsonValue(fields.payload)
  const { overlay } = uncheckedFields<AgentLoopCustomInteraction['renderer']>(fields.renderer)

  return {
    ...base,
    kind: 'custom',
    customType,
    ...(payload !== undefined ? { payload } : {}),
    renderer: {
      kind: 'pi-tui-custom',
      supported: false,
      ...(typeof overlay === 'boolean' ? { overlay } : {}),
    },
  }
}

export function parseInteraction(
  interaction: unknown,
): AgentTransportInteractionRequestEvent['interaction'] | null {
  const fields = uncheckedFields<AgentLoopInteractionBase>(interaction)

  const base = baseInteractionFields(interaction)
  if (base === null) {
    return null
  }

  return match(fields.kind)
    .with('confirm', () => parseConfirmInteraction(base, interaction))
    .with('select', () => parseSelectInteraction(base, interaction))
    .with('input', () => parseInputInteraction(base, interaction))
    .with('editor', () => parseEditorInteraction(base, interaction))
    .with('notify', () => parseNotifyInteraction(base, interaction))
    .with('custom', () => parseCustomInteraction(base, interaction))
    .otherwise(() => null)
}

export function parseErrorInfo(error: unknown): AgentTransportInteractionResolvedEvent['error'] {
  const fields = uncheckedFields<AgentTransportErrorInfo>(error)

  const message = stringOrNull(fields.message)
  if (message === null) {
    return undefined
  }

  const code = stringOrNull(fields.code)
  const name = stringOrNull(fields.name)
  const stack = stringOrNull(fields.stack)
  return {
    message,
    ...(code !== null ? { code } : {}),
    ...(name !== null ? { name } : {}),
    ...(stack !== null ? { stack } : {}),
  }
}

export function parseInteractionKind(value: string | null): AgentLoopInteractionKind | null {
  if (
    value === 'confirm' ||
    value === 'select' ||
    value === 'input' ||
    value === 'editor' ||
    value === 'notify' ||
    value === 'custom'
  ) {
    return value
  }

  return null
}

export function parseInteractionStatus(value: string | null): AgentLoopInteractionStatus | null {
  if (value === 'pending' || value === 'resolved' || value === 'cancelled' || value === 'errored') {
    return value
  }

  return null
}
