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
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import {
  isObject,
  numberField,
  optionalJsonValue,
  stringField,
  type UnknownObject,
} from './agent-loop-transcript-event-fields'

type AgentLoopInteractionBaseFields = Omit<AgentLoopInteractionBase, 'kind'>

function baseInteractionFields(interaction: UnknownObject): AgentLoopInteractionBaseFields | null {
  const interactionId = stringField(interaction, 'interactionId')
  const sessionId = stringField(interaction, 'sessionId')
  const runId = stringField(interaction, 'runId')
  const source = stringField(interaction, 'source')
  const createdAt = numberField(interaction, 'createdAt')

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
  const timeoutMs = numberField(interaction, 'timeoutMs')
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
  if (!isObject(value)) return null
  const requester = stringField(value, 'requester')
  const requesterId = stringField(value, 'requesterId')
  if (requester === null || requesterId === null) return null
  const capability = stringField(value, 'capability')
  if (!isAgentAuthorizationCapability(capability)) return null

  const resource = stringField(value, 'resource')
  return { capability, requester, requesterId, ...(resource === null ? {} : { resource }) }
}

function parseConfirmInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopConfirmInteraction | null {
  const title = stringField(interaction, 'title')
  const message = stringField(interaction, 'message')
  if (title === null || message === null) return null

  const scopeKey = parseScopeKey(interaction.scopeKey)
  return {
    ...base,
    kind: 'confirm',
    title,
    message,
    purpose: parseConfirmPurpose(stringField(interaction, 'purpose')),
    ...(scopeKey === null ? {} : { scopeKey }),
  }
}

function parseSelectInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopSelectInteraction | null {
  const title = stringField(interaction, 'title')
  const choices = parseChoices(interaction.choices)
  return title !== null && choices !== null ? { ...base, kind: 'select', title, choices } : null
}

function parseInputInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopInputInteraction | null {
  const title = stringField(interaction, 'title')
  const placeholder = stringField(interaction, 'placeholder')
  return title !== null
    ? { ...base, kind: 'input', title, ...(placeholder !== null ? { placeholder } : {}) }
    : null
}

function parseEditorInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopEditorInteraction | null {
  const title = stringField(interaction, 'title')
  const prefill = stringField(interaction, 'prefill')
  return title !== null
    ? { ...base, kind: 'editor', title, ...(prefill !== null ? { prefill } : {}) }
    : null
}

function parseNotifyInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopNotifyInteraction | null {
  const message = stringField(interaction, 'message')
  const level = stringField(interaction, 'level')
  if (message === null || (level !== 'info' && level !== 'warning' && level !== 'error')) {
    return null
  }
  return { ...base, kind: 'notify', message, level }
}

function parseCustomInteraction(
  base: AgentLoopInteractionBaseFields,
  interaction: UnknownObject,
): AgentLoopCustomInteraction | null {
  const customType =
    stringField(interaction, 'customType') ?? OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE
  const payload = optionalJsonValue(interaction.payload)
  const renderer = isObject(interaction.renderer) ? interaction.renderer : null
  const overlay = renderer?.overlay

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
  if (!isObject(interaction)) {
    return null
  }

  const base = baseInteractionFields(interaction)
  if (base === null) {
    return null
  }

  return match(interaction.kind)
    .with('confirm', () => parseConfirmInteraction(base, interaction))
    .with('select', () => parseSelectInteraction(base, interaction))
    .with('input', () => parseInputInteraction(base, interaction))
    .with('editor', () => parseEditorInteraction(base, interaction))
    .with('notify', () => parseNotifyInteraction(base, interaction))
    .with('custom', () => parseCustomInteraction(base, interaction))
    .otherwise(() => null)
}

export function parseErrorInfo(error: unknown): AgentTransportInteractionResolvedEvent['error'] {
  if (!isObject(error)) {
    return undefined
  }

  const message = stringField(error, 'message')
  if (message === null) {
    return undefined
  }

  const code = stringField(error, 'code')
  const name = stringField(error, 'name')
  const stack = stringField(error, 'stack')
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
