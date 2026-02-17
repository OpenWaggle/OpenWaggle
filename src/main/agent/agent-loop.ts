import { randomUUID } from 'node:crypto'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { chat, maxIterations, type StreamChunk } from '@tanstack/ai'
import { providerRegistry } from '../providers'
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
    id: MessageId(randomUUID()),
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

  // Resolve provider and adapter via the registry
  const provider = providerRegistry.getProviderForModel(model)
  if (!provider) throw new Error(`No provider registered for model: ${model}`)

  const providerConfig = settings.providers[provider.id as Provider]
  if (provider.requiresApiKey && !providerConfig?.apiKey) {
    throw new Error(`No API key configured for ${provider.displayName}`)
  }

  const adapter = provider.createAdapter(
    model,
    providerConfig?.apiKey ?? '',
    providerConfig?.baseUrl,
  )

  const systemPrompt = buildSystemPrompt(conversation.projectPath)
  const abortController = new AbortController()
  signal.addEventListener('abort', () => abortController.abort(), { once: true })

  // Build messages
  const existingMessages = conversationToMessages(conversation.messages)
  const newUserMessage: SimpleChatMessage = { role: 'user', content: userMessage }
  const allMessages = [...existingMessages, newUserMessage]

  const hasProject = !!conversation.projectPath

  const stream: AsyncIterable<StreamChunk> = chat({
    adapter,
    messages: allMessages,
    systemPrompts: [systemPrompt],
    tools: hasProject ? getServerTools() : [],
    agentLoopStrategy: maxIterations(MAX_ITERATIONS),
    abortController,
  })

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
        const rawArgs = toolCallArgs[chunk.toolCallId] ?? '{}'
        try {
          args = JSON.parse(rawArgs)
        } catch (parseError) {
          console.warn(
            `Failed to parse tool call args for "${chunk.toolName}":`,
            parseError instanceof Error ? parseError.message : parseError,
            `| raw: ${rawArgs.slice(0, 200)}`,
          )
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
