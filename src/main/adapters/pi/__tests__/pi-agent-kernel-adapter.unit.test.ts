import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentSendPayload } from '@shared/types/agent'
import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { createSessionListener } from '../pi-agent-kernel-adapter'
import {
  buildPiRunAssistantMessages,
  buildPiRunNewMessages,
  extractPiAssistantTerminalError,
} from '../pi-run-result'

function makePayload(overrides: Partial<AgentSendPayload> = {}): AgentSendPayload {
  return {
    text: 'Build a coding game in this repo',
    thinkingLevel: 'medium',
    attachments: [],
    ...overrides,
  }
}

function makeRunInput(onEvent: (event: AgentTransportEvent) => void): AgentKernelRunInput {
  return {
    conversation: {
      id: ConversationId('conv-tool-events'),
      title: 'Tool events',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    },
    payload: {
      text: 'Run tests',
      thinkingLevel: 'medium',
      attachments: [],
    },
    model: SupportedModelId('openai/gpt-5.4'),
    signal: new AbortController().signal,
    onEvent,
  }
}

type MessageStartEvent = Extract<AgentSessionEvent, { readonly type: 'message_start' }>

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

describe('extractPiAssistantTerminalError', () => {
  it('returns the assistant error message for terminal Pi error messages', () => {
    const appendedMessages = [
      {
        role: 'assistant',
        model: 'gpt-5.4',
        content: [],
        stopReason: 'error',
        errorMessage: 'Codex error: server_error',
      },
    ]

    expect(extractPiAssistantTerminalError(appendedMessages)).toBe('Codex error: server_error')
  })

  it('ignores successful assistant messages', () => {
    const appendedMessages = [
      {
        role: 'assistant',
        model: 'gpt-5.4',
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'stop',
      },
    ]

    expect(extractPiAssistantTerminalError(appendedMessages)).toBeNull()
  })
})

describe('buildPiRunNewMessages', () => {
  it('prepends the persisted user message for normal runs', () => {
    const payload = makePayload()
    const appendedMessages = [
      {
        role: 'assistant',
        model: 'gpt-5.4',
        content: [{ type: 'text', text: 'I can help with that.' }],
      },
    ]

    const result = buildPiRunNewMessages(payload, appendedMessages)

    expect(result.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(result[0]?.parts).toMatchObject([{ type: 'text', text: payload.text }])
    expect(result[1]?.parts).toMatchObject([{ type: 'text', text: 'I can help with that.' }])
  })
})

describe('buildPiRunAssistantMessages', () => {
  it('returns only assistant/tool messages for custom Waggle turns', () => {
    const appendedMessages = [
      {
        role: 'custom',
        customType: 'openwaggle.waggle.turn',
        content: 'hidden coordination prompt',
        display: false,
      },
      {
        role: 'assistant',
        model: 'gpt-5.4',
        content: [{ type: 'text', text: 'Agent turn output.' }],
      },
    ]

    const result = buildPiRunAssistantMessages(appendedMessages)

    expect(result.map((message) => message.role)).toEqual(['assistant'])
    expect(result[0]?.parts).toMatchObject([{ type: 'text', text: 'Agent turn output.' }])
  })
})

describe('createSessionListener', () => {
  it('forwards Pi agent-end stop reason and token usage', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      makeRunInput((event) => emitted.push(event)),
      'run-1',
    )

    listener({
      type: 'agent_end',
      messages: [
        {
          role: 'assistant',
          content: [],
          api: 'openai-completions',
          provider: 'openwaggle',
          model: 'gpt-5.4',
          usage: { ...usage, input: 11, output: 7, totalTokens: 18 },
          stopReason: 'length',
          timestamp: 1,
        },
      ],
    })

    expect(emitted).toMatchObject([
      {
        type: 'agent_end',
        runId: 'run-1',
        reason: 'length',
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
        },
      },
    ])
  })

  it('forwards Pi session queue, compaction, and auto-retry events', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      makeRunInput((event) => emitted.push(event)),
      'run-1',
    )

    listener({ type: 'queue_update', steering: ['adjust plan'], followUp: ['run tests'] })
    listener({ type: 'compaction_start', reason: 'threshold' })
    listener({
      type: 'compaction_end',
      reason: 'threshold',
      result: {
        summary: 'Kept the latest task context.',
        firstKeptEntryId: 'node-2',
        tokensBefore: 10,
      },
      aborted: false,
      willRetry: true,
    })
    listener({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 250,
      errorMessage: 'context overflow',
    })
    listener({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'still failed' })

    expect(emitted).toMatchObject([
      { type: 'queue_update', steering: ['adjust plan'], followUp: ['run tests'] },
      { type: 'compaction_start', reason: 'threshold' },
      {
        type: 'compaction_end',
        reason: 'threshold',
        result: {
          summary: 'Kept the latest task context.',
          firstKeptEntryId: 'node-2',
          tokensBefore: 10,
        },
        aborted: false,
        willRetry: true,
      },
      {
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 2,
        delayMs: 250,
        errorMessage: 'context overflow',
      },
      { type: 'auto_retry_end', success: false, attempt: 1, finalError: 'still failed' },
    ])
  })

  it('forwards Pi tool-call and tool-execution lifecycle events without losing result state', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      makeRunInput((event) => emitted.push(event)),
      'run-1',
    )
    const assistantMessage: MessageStartEvent['message'] = {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'false' },
        },
      ],
      api: 'openai-completions',
      provider: 'openwaggle',
      model: 'gpt-5.4',
      usage,
      stopReason: 'toolUse',
      timestamp: 1,
    }
    const toolResult = {
      content: [{ type: 'text', text: 'Command exited with code 1' }],
      details: { fullOutputPath: '/tmp/pi-bash.log' },
    }

    const messageStart: AgentSessionEvent = {
      type: 'message_start',
      message: assistantMessage,
    }
    const toolCallStart: AgentSessionEvent = {
      type: 'message_update',
      message: assistantMessage,
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: assistantMessage,
      },
    }
    const toolExecutionStart: AgentSessionEvent = {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'false' },
    }
    const toolExecutionUpdate: AgentSessionEvent = {
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'false' },
      partialResult: { content: [{ type: 'text', text: 'running' }], details: undefined },
    }
    const toolExecutionEnd: AgentSessionEvent = {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: toolResult,
      isError: true,
    }

    listener(messageStart)
    listener(toolCallStart)
    listener(toolExecutionStart)
    listener(toolExecutionUpdate)
    listener(toolExecutionEnd)

    expect(emitted.map((event) => event.type)).toEqual([
      'message_start',
      'message_update',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
    ])
    expect(emitted[1]).toMatchObject({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: { command: 'false' },
      },
    })
    expect(emitted[4]).toMatchObject({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'false' },
      result: toolResult,
      isError: true,
    })
  })
})
