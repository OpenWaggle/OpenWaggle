import { randomUUID } from 'node:crypto'
import { isMatching, P } from '@diegogbrisa/ts-match'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import {
  buildPersistedUserMessageParts,
  type PersistedUserMessagePartsPayload,
} from '../../agent/shared'
import { piHistoryToProjectedMessages } from './pi-message-mapper'

function makeMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: SupportedModelId,
) {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model,
    createdAt: Date.now(),
  }
}

interface PiRuntimeAssistantMessage {
  readonly role: 'assistant'
  readonly content: readonly unknown[]
  readonly model: string
  readonly stopReason?: string
  readonly errorMessage?: string
}

interface PiRuntimeToolResultMessage {
  readonly role: 'toolResult'
  readonly toolCallId: string
  readonly toolName: string
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly details?: unknown
}

function isPiRuntimeAssistantMessage(value: unknown): value is PiRuntimeAssistantMessage {
  return isMatching(
    {
      role: 'assistant',
      content: P.array(P._),
      model: P.string,
      stopReason: P.optional(P.string),
      errorMessage: P.optional(P.string),
    },
    value,
  )
}

function isPiRuntimeToolResultMessage(value: unknown): value is PiRuntimeToolResultMessage {
  return isMatching(
    {
      role: 'toolResult',
      toolCallId: P.string,
      toolName: P.string,
      content: P.array(P._),
      isError: P.boolean,
      details: P.optional(P._),
    },
    value,
  )
}

export function getPiAssistantStopReason(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isPiRuntimeAssistantMessage(message)) {
      continue
    }

    return message.stopReason ?? null
  }

  return null
}

export function extractPiAssistantTerminalError(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isPiRuntimeAssistantMessage(message)) {
      continue
    }

    if (message.stopReason === 'error') {
      return message.errorMessage ?? `Pi assistant run ended with ${message.stopReason}.`
    }

    return null
  }

  return null
}

export function buildPiRunNewMessages(
  payload: PersistedUserMessagePartsPayload,
  appendedMessages: readonly unknown[],
): Message[] {
  const filteredAppended = appendedMessages.filter(
    (message) => isPiRuntimeAssistantMessage(message) || isPiRuntimeToolResultMessage(message),
  )

  const assistantAndToolMessages = piHistoryToProjectedMessages(filteredAppended)
  return [makeMessage('user', buildPersistedUserMessageParts(payload)), ...assistantAndToolMessages]
}

export function buildPiRunAssistantMessages(appendedMessages: readonly unknown[]): Message[] {
  const filteredAppended = appendedMessages.filter(
    (message) => isPiRuntimeAssistantMessage(message) || isPiRuntimeToolResultMessage(message),
  )

  return piHistoryToProjectedMessages(filteredAppended)
}
