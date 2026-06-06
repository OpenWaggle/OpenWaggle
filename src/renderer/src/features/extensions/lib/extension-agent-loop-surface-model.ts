import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ChatToolCallPart } from '@shared/types/chat-ui'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { ExtensionAgentLoopTarget } from './extension-agent-loop-resolution'

export interface ExtensionToolResultView {
  readonly content: string
  readonly state: string
  readonly error?: string
}

export interface ExtensionCustomMessageView {
  readonly name: string
  readonly value: JsonValue
}

export interface ExtensionInteractionActionView {
  readonly id: string
  readonly label: string
  readonly tone?: 'primary' | 'secondary' | 'danger'
}

export interface ExtensionInteractionView {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly description?: string
  readonly state: 'pending' | 'submitted' | 'cancelled' | 'expired'
  readonly actions: readonly ExtensionInteractionActionView[]
}

export interface ExtensionStatusView {
  readonly label: string
  readonly detail?: string
  readonly tone: 'neutral' | 'running' | 'success' | 'warning' | 'error'
}

export interface ExtensionTranscriptView {
  readonly sessionId: string | null
  readonly projectPaths: readonly string[]
  readonly messageCount: number
  readonly state: 'empty' | 'active'
}

export type ExtensionAgentLoopSurfaceInput =
  | {
      readonly surface: 'tool'
      readonly toolCall: ChatToolCallPart
      readonly toolResult?: ExtensionToolResultView
    }
  | {
      readonly surface: 'custom-message'
      readonly message: ExtensionCustomMessageView
    }
  | {
      readonly surface: 'interaction'
      readonly interaction: ExtensionInteractionView
      readonly onAction?: (interactionId: string, actionId: string) => void
    }
  | {
      readonly surface: 'status'
      readonly status: ExtensionStatusView
    }
  | {
      readonly surface: 'transcript'
      readonly transcript: ExtensionTranscriptView
    }

function textPayload(value: string): JsonValue {
  return value
}

export function surfaceTarget(input: ExtensionAgentLoopSurfaceInput): ExtensionAgentLoopTarget {
  if (input.surface === 'tool') {
    return { surface: 'tool', toolName: input.toolCall.name }
  }

  if (input.surface === 'custom-message') {
    return { surface: 'custom-message', customMessageName: input.message.name }
  }

  if (input.surface === 'interaction') {
    return { surface: 'interaction', interactionKind: input.interaction.kind }
  }

  if (input.surface === 'transcript') {
    return { surface: 'transcript' }
  }

  return { surface: 'status' }
}

export function surfacePayload(input: ExtensionAgentLoopSurfaceInput): JsonObject {
  if (input.surface === 'tool') {
    return {
      surface: 'tool',
      toolCall: {
        id: input.toolCall.id,
        name: input.toolCall.name,
        arguments: input.toolCall.arguments,
        state: input.toolCall.state,
      },
      ...(input.toolResult !== undefined
        ? {
            toolResult: {
              content: textPayload(input.toolResult.content),
              state: input.toolResult.state,
              ...(input.toolResult.error !== undefined ? { error: input.toolResult.error } : {}),
            },
          }
        : {}),
    }
  }

  if (input.surface === 'custom-message') {
    return {
      surface: 'custom-message',
      message: {
        name: input.message.name,
        value: input.message.value,
      },
    }
  }

  if (input.surface === 'interaction') {
    return {
      surface: 'interaction',
      interaction: {
        id: input.interaction.id,
        kind: input.interaction.kind,
        title: input.interaction.title,
        ...(input.interaction.description !== undefined
          ? { description: input.interaction.description }
          : {}),
        state: input.interaction.state,
        actions: input.interaction.actions.map((action) => ({
          id: action.id,
          label: action.label,
          ...(action.tone !== undefined ? { tone: action.tone } : {}),
        })),
      },
    }
  }

  if (input.surface === 'transcript') {
    return {
      surface: 'transcript',
      transcript: {
        sessionId: input.transcript.sessionId,
        projectPaths: [...input.transcript.projectPaths],
        messageCount: input.transcript.messageCount,
        state: input.transcript.state,
      },
    }
  }

  return {
    surface: 'status',
    status: {
      label: input.status.label,
      ...(input.status.detail !== undefined ? { detail: input.status.detail } : {}),
      tone: input.status.tone,
    },
  }
}

export function surfaceLabel(input: ExtensionAgentLoopSurfaceInput) {
  if (input.surface === 'tool') {
    return `Tool output · ${input.toolCall.name}`
  }

  if (input.surface === 'custom-message') {
    return `Custom message · ${input.message.name}`
  }

  if (input.surface === 'interaction') {
    return `Interaction · ${input.interaction.kind}`
  }

  if (input.surface === 'transcript') {
    return 'Transcript summary'
  }

  return 'Run status'
}

export function surfaceFamily(input: ExtensionAgentLoopSurfaceInput) {
  if (input.surface === 'tool') {
    return OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS
  }

  if (input.surface === 'custom-message') {
    return OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS
  }

  if (input.surface === 'interaction') {
    return OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS
  }

  if (input.surface === 'transcript') {
    return OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS
  }

  return OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS
}
