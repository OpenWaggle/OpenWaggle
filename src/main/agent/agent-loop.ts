import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { chat, maxIterations, type StreamChunk } from '@tanstack/ai'
import {
  ANTHROPIC_MODELS,
  type AnthropicChatModel,
  createAnthropicChat,
} from '@tanstack/ai-anthropic'
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai'
import { v4 as uuid } from 'uuid'
import { setToolContext } from '../tools/define-tool'
import { getServerTools } from '../tools/registry'
import { buildSystemPrompt } from './system-prompt'

const MAX_ITERATIONS = 25

export interface AgentRunParams {
  readonly conversation: Conversation
  readonly userMessage: string
  readonly model: SupportedModelId
  readonly settings: Settings
  /** Forward raw StreamChunks to the renderer via IPC for the useChat adapter */
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
}

export interface AgentRunResult {
  readonly newMessages: readonly Message[]
  readonly finalMessage: Message
}

/**
 * Simple message shape for TanStack AI — content is always string | null.
 * Using structural typing instead of importing ModelMessage avoids
 * ConstrainedModelMessage type parameter mismatches across providers.
 */
interface SimpleChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  toolCallId?: string
}

/** Type predicate: narrow SupportedModelId to AnthropicChatModel */
function isAnthropicModel(model: SupportedModelId): model is AnthropicChatModel {
  return (ANTHROPIC_MODELS as readonly string[]).includes(model)
}

function getApiKey(model: SupportedModelId, settings: Settings): string {
  const provider = isAnthropicModel(model) ? 'anthropic' : 'openai'
  const apiKey = settings.providers[provider]?.apiKey
  if (!apiKey) throw new Error(`No API key configured for ${provider}`)
  return apiKey
}

/**
 * Run the agent for the Anthropic provider.
 * Separated so TypeScript can fully infer adapter + chat() types.
 */
function runAnthropicChat(
  model: AnthropicChatModel,
  apiKey: string,
  messages: SimpleChatMessage[],
  systemPrompt: string,
  hasProject: boolean,
  abortController: AbortController,
) {
  const adapter = createAnthropicChat(model, apiKey)
  return chat({
    adapter,
    messages,
    systemPrompts: [systemPrompt],
    tools: hasProject ? getServerTools() : [],

    agentLoopStrategy: maxIterations(MAX_ITERATIONS),
    abortController,
  })
}

/**
 * Run the agent for the OpenAI provider.
 * Separated so TypeScript can fully infer adapter + chat() types.
 */
function runOpenaiChat(
  model: OpenAIChatModel,
  apiKey: string,
  messages: SimpleChatMessage[],
  systemPrompt: string,
  hasProject: boolean,
  abortController: AbortController,
) {
  const adapter = createOpenaiChat(model, apiKey)
  return chat({
    adapter,
    messages,
    systemPrompts: [systemPrompt],
    tools: hasProject ? getServerTools() : [],

    agentLoopStrategy: maxIterations(MAX_ITERATIONS),
    abortController,
  })
}

/**
 * Convert our Message[] to simple ChatMessage[].
 * Handles text, tool_use, and tool_result parts.
 */
function conversationToMessages(messages: readonly Message[]): SimpleChatMessage[] {
  const result: SimpleChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.parts
        .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
      result.push({ role: 'user', content: text })
    } else if (msg.role === 'assistant') {
      const toolCalls = msg.parts
        .filter((p): p is Extract<MessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
        .map((p) => ({
          id: String(p.toolCall.id),
          type: 'function' as const,
          function: {
            name: p.toolCall.name,
            arguments: JSON.stringify(p.toolCall.args),
          },
        }))

      const textParts = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text',
      )

      const textContent = textParts.map((p) => p.text).join('\n')

      result.push({
        role: 'assistant',
        content: textContent || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      })

      // Tool results as separate tool messages
      const toolResults = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'tool-result' }> => p.type === 'tool-result',
      )
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: tr.toolResult.result,
          toolCallId: String(tr.toolResult.id),
        })
      }
    }
  }

  return result
}

function makeMessage(
  role: 'user' | 'assistant',
  parts: MessagePart[],
  model?: SupportedModelId,
): Message {
  return {
    id: MessageId(uuid()),
    role,
    parts,
    model,
    createdAt: Date.now(),
  }
}

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const { conversation, userMessage, model, settings, onChunk, signal } = params

  // Set tool context for this run
  setToolContext({
    projectPath: conversation.projectPath ?? process.cwd(),
    signal,
  })

  const apiKey = getApiKey(model, settings)
  const systemPrompt = buildSystemPrompt(conversation.projectPath)
  const abortController = new AbortController()
  signal.addEventListener('abort', () => abortController.abort(), { once: true })

  // Build messages
  const existingMessages = conversationToMessages(conversation.messages)
  const newUserMessage: SimpleChatMessage = { role: 'user', content: userMessage }
  const allMessages = [...existingMessages, newUserMessage]

  const hasProject = !!conversation.projectPath

  // Dispatch to provider-specific function for proper type inference
  const stream: AsyncIterable<StreamChunk> = isAnthropicModel(model)
    ? runAnthropicChat(model, apiKey, allMessages, systemPrompt, hasProject, abortController)
    : runOpenaiChat(model, apiKey, allMessages, systemPrompt, hasProject, abortController)

  // Collect events for building our Message objects
  const collectedParts: MessagePart[] = []
  let currentText = ''
  const toolCallArgs: Record<string, string> = {}

  for await (const chunk of stream) {
    if (signal.aborted) break

    // Forward raw chunk to renderer for the useChat IPC adapter
    onChunk(chunk)

    // Collect message parts for persistence
    switch (chunk.type) {
      case 'TEXT_MESSAGE_CONTENT':
        currentText += chunk.delta
        break

      case 'TOOL_CALL_START':
        // Flush accumulated text
        if (currentText.trim()) {
          collectedParts.push({ type: 'text', text: currentText })
          currentText = ''
        }
        toolCallArgs[chunk.toolCallId] = ''
        break

      case 'TOOL_CALL_ARGS':
        toolCallArgs[chunk.toolCallId] = (toolCallArgs[chunk.toolCallId] ?? '') + chunk.delta
        break

      case 'TOOL_CALL_END': {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(toolCallArgs[chunk.toolCallId] ?? '{}')
        } catch {
          // malformed JSON — use empty args
        }

        collectedParts.push({
          type: 'tool-call',
          toolCall: { id: ToolCallId(chunk.toolCallId), name: chunk.toolName, args },
        })

        // TanStack AI executes the tool via ServerTool.execute and provides the result
        if (chunk.result !== undefined) {
          collectedParts.push({
            type: 'tool-result',
            toolResult: {
              id: ToolCallId(chunk.toolCallId),
              name: chunk.toolName,
              args,
              result:
                typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result),
              isError: false,
              duration: 0,
            },
          })
        }
        break
      }

      case 'RUN_FINISHED':
      case 'RUN_ERROR':
        break
    }
  }

  // Flush remaining text
  if (currentText.trim()) {
    collectedParts.push({ type: 'text', text: currentText })
  }

  const finalParts =
    collectedParts.length > 0 ? collectedParts : [{ type: 'text' as const, text: '(no response)' }]

  const userMsg = makeMessage('user', [{ type: 'text', text: userMessage }])
  const assistantMsg = makeMessage('assistant', finalParts, model)

  return { newMessages: [userMsg, assistantMsg], finalMessage: assistantMsg }
}
