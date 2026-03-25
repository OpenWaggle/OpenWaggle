import type { ModelMessage, UIMessage } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import {
  normalizeContinuationAsUIMessages,
  normalizeContinuationInput,
} from '../continuation-normalizer'

function makeUiTextMessage(id: string, role: UIMessage['role'], content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
  }
}

function makeToolCall(id: string): NonNullable<ModelMessage['toolCalls']>[number] {
  return {
    id,
    type: 'function',
    function: {
      name: 'writeFile',
      arguments: '{"path":"a.txt"}',
    },
  }
}

describe('normalizeContinuationInput', () => {
  it('drops system UI snapshot messages instead of remapping them to user role', () => {
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('sys-1', 'system', 'internal instruction'),
      makeUiTextMessage('user-1', 'user', 'hello'),
    ]

    const normalized = normalizeContinuationInput(input)

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      role: 'user',
      content: 'hello',
    })
  })

  it('dedupes repeated assistant tool calls but preserves assistant text content', () => {
    const repeatedToolCall = makeToolCall('tool-1')
    const input: Array<ModelMessage | UIMessage> = [
      { role: 'assistant', content: null, toolCalls: [repeatedToolCall] },
      {
        role: 'assistant',
        content: 'still waiting',
        toolCalls: [repeatedToolCall],
      },
    ]

    const normalized = normalizeContinuationInput(input)

    // After dedup: one assistant message + one synthetic tool result
    // for the orphan tool call (enforceToolResultPairing).
    expect(normalized).toHaveLength(2)
    expect(normalized[0]).toMatchObject({
      role: 'assistant',
      content: 'still waiting',
      toolCalls: [repeatedToolCall],
    })
    expect(normalized[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'tool-1',
    })
  })

  it('sanitizes malformed JSON arguments in model tool calls', () => {
    const input: Array<ModelMessage | UIMessage> = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'tool-bad-model',
            type: 'function',
            function: {
              name: 'writeFile',
              arguments: '{"path":"OpenWaggle-Summary.md"',
            },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationInput(input)
    expect(normalized[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [
        {
          id: 'tool-bad-model',
          function: {
            arguments: '{}',
          },
        },
      ],
    })
  })

  it('sanitizes malformed JSON arguments in UI snapshot tool-call parts', () => {
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('user-2', 'user', 'please continue'),
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-bad-ui',
            name: 'writeFile',
            arguments: '{"path":"OpenWaggle-Summary.md"',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-bad-ui',
              needsApproval: true,
              approved: true,
            },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationInput(input)
    expect(
      normalized.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls?.some(
            (toolCall) => toolCall.id === 'tool-bad-ui' && toolCall.function.arguments === '{}',
          ) === true,
      ),
    ).toBe(true)
    expect(
      normalized.some((message) => message.role === 'tool' && message.toolCallId === 'tool-bad-ui'),
    ).toBe(true)
  })

  it('drops stale tool-result parts when a newer message already carries the same tool-call id', () => {
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('user-1', 'user', 'run this command'),
      {
        id: 'assistant-older',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-stale',
            name: 'runCommand',
            arguments: '{"command":"echo old"}',
            state: 'input-complete',
          },
          {
            type: 'tool-result',
            toolCallId: 'tool-stale',
            content: '{"kind":"text","text":"old"}',
            state: 'complete',
          },
        ],
      },
      {
        id: 'assistant-newer',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-stale',
            name: 'runCommand',
            arguments: '{"command":"echo new"}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-stale',
              needsApproval: true,
              approved: true,
            },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationInput(input)

    const toolMessages = normalized.filter(
      (message): message is ModelMessage<string> =>
        message.role === 'tool' &&
        message.toolCallId === 'tool-stale' &&
        typeof message.content === 'string',
    )

    expect(toolMessages).toHaveLength(1)
    expect(JSON.parse(toolMessages[0]?.content ?? '{}')).toMatchObject({
      approved: true,
      pendingExecution: true,
    })
    expect(
      normalized.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls?.some((toolCall) => toolCall.id === 'tool-stale') === true,
      ),
    ).toBe(true)
  })

  it('replaces stale tool result with synthetic result when newer assistant tool-call exists', () => {
    const input: Array<ModelMessage | UIMessage> = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [makeToolCall('tool-model')],
      },
      {
        role: 'tool',
        content: '{"kind":"text","text":"old"}',
        toolCallId: 'tool-model',
      },
      {
        role: 'assistant',
        content: null,
        toolCalls: [makeToolCall('tool-model')],
      },
    ]

    const normalized = normalizeContinuationInput(input)

    // The newer tool-call wins; old tool result is dropped.
    // enforceToolResultPairing injects a synthetic result so
    // the API doesn't receive an orphan tool_use block.
    const toolMessages = normalized.filter(
      (message): message is ModelMessage<string> =>
        message.role === 'tool' && message.toolCallId === 'tool-model',
    )
    expect(toolMessages).toHaveLength(1)
    expect(JSON.parse(toolMessages[0]?.content ?? '{}')).toMatchObject({
      ok: false,
      error: 'Tool execution was interrupted.',
    })
    expect(
      normalized.some(
        (message) =>
          message.role === 'assistant' &&
          message.toolCalls?.some((toolCall) => toolCall.id === 'tool-model') === true,
      ),
    ).toBe(true)
  })

  it('drops tool messages that do not directly follow an assistant message with matching tool call id', () => {
    const input: Array<ModelMessage | UIMessage> = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [makeToolCall('tool-paired')],
      },
      {
        role: 'tool',
        content: '{"kind":"text","text":"paired"}',
        toolCallId: 'tool-paired',
      },
      {
        role: 'assistant',
        content: 'follow-up text',
      },
      {
        role: 'tool',
        content: '{"kind":"text","text":"orphaned"}',
        toolCallId: 'tool-orphaned',
      },
    ]

    const normalized = normalizeContinuationInput(input)
    const toolMessages = normalized.filter(
      (message): message is ModelMessage<string> => message.role === 'tool',
    )

    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      role: 'tool',
      toolCallId: 'tool-paired',
      content: '{"kind":"text","text":"paired"}',
    })
  })

  it('keeps consecutive tool messages that match tool calls from the same assistant turn', () => {
    const input: Array<ModelMessage | UIMessage> = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [makeToolCall('tool-a'), makeToolCall('tool-b')],
      },
      {
        role: 'tool',
        content: '{"kind":"text","text":"result-a"}',
        toolCallId: 'tool-a',
      },
      {
        role: 'tool',
        content: '{"kind":"text","text":"result-b"}',
        toolCallId: 'tool-b',
      },
    ]

    const normalized = normalizeContinuationInput(input)
    const toolMessages = normalized.filter(
      (message): message is ModelMessage<string> => message.role === 'tool',
    )

    expect(toolMessages).toHaveLength(2)
    expect(toolMessages[0]).toMatchObject({
      role: 'tool',
      toolCallId: 'tool-a',
      content: '{"kind":"text","text":"result-a"}',
    })
    expect(toolMessages[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'tool-b',
      content: '{"kind":"text","text":"result-b"}',
    })
  })

  it('defaults missing UI tool-call state to input-complete so tool pairing survives conversion', () => {
    const malformedAssistant = JSON.parse(
      '{"id":"assistant-missing-state","role":"assistant","parts":[{"type":"tool-call","id":"tool-missing-state","name":"runCommand","arguments":"{\\"command\\":\\"echo hi\\"}"},{"type":"tool-result","toolCallId":"tool-missing-state","content":"{\\"kind\\":\\"text\\",\\"text\\":\\"hi\\"}","state":"complete"}]}',
    ) as UIMessage
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('user-3', 'user', 'continue'),
      malformedAssistant,
    ]

    const normalized = normalizeContinuationInput(input)
    const assistantWithToolCall = normalized.find(
      (message) =>
        message.role === 'assistant' &&
        message.toolCalls?.some((toolCall) => toolCall.id === 'tool-missing-state') === true,
    )
    const pairedToolResult = normalized.find(
      (message) => message.role === 'tool' && message.toolCallId === 'tool-missing-state',
    )

    expect(assistantWithToolCall).toBeTruthy()
    expect(pairedToolResult).toBeTruthy()
  })

  it('recovers non-empty args from richer duplicate tool-call entries', () => {
    const malformedNewerAssistant = JSON.parse(
      '{"id":"assistant-newer-poor","role":"assistant","parts":[{"type":"tool-call","id":"tool-rich","name":"runCommand","arguments":"{}"},{"type":"tool-result","toolCallId":"tool-rich","content":"{\\"kind\\":\\"text\\",\\"text\\":\\"done\\"}","state":"complete"}]}',
    ) as UIMessage
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('user-4', 'user', 'run command'),
      {
        id: 'assistant-older-rich',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-rich',
            name: 'runCommand',
            arguments: '{"command":"echo second command"}',
            state: 'input-complete',
          },
        ],
      },
      malformedNewerAssistant,
    ]

    const normalized = normalizeContinuationInput(input)
    const recoveredToolCall = normalized
      .filter((message): message is ModelMessage => message.role === 'assistant')
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === 'tool-rich')

    expect(recoveredToolCall?.function.arguments).toBe('{"command":"echo second command"}')
  })

  it('prefers concrete tool output over approval pendingExecution replay when both exist', () => {
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('user-5', 'user', 'continue'),
      {
        id: 'assistant-output-vs-approval',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-output',
            name: 'runCommand',
            arguments: '{"command":"echo done"}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-output',
              needsApproval: true,
              approved: true,
            },
            output: {
              kind: 'text',
              text: 'done',
            },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationInput(input)
    const toolMessage = normalized.find(
      (message): message is ModelMessage<string> =>
        message.role === 'tool' &&
        message.toolCallId === 'tool-output' &&
        typeof message.content === 'string',
    )

    expect(toolMessage).toBeTruthy()
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as Record<string, unknown>
    expect(parsed).toMatchObject({
      kind: 'text',
      text: 'done',
    })
    expect(parsed).not.toHaveProperty('pendingExecution')
  })
})

describe('normalizeContinuationAsUIMessages', () => {
  it('injects synthetic tool-result for orphan tool-call with state input-complete', () => {
    const input: UIMessage[] = [
      makeUiTextMessage('user-1', 'user', 'do it'),
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'orphan-tc',
            name: 'readFile',
            arguments: '{"path":"a.txt"}',
            state: 'input-complete',
          },
        ],
      },
    ]

    const normalized = normalizeContinuationAsUIMessages(input)
    const assistantMsg = normalized.find((m) => 'parts' in m && m.role === 'assistant') as
      | UIMessage
      | undefined

    expect(assistantMsg).toBeTruthy()
    const toolResultPart = assistantMsg?.parts.find(
      (p) => p.type === 'tool-result' && p.toolCallId === 'orphan-tc',
    )
    expect(toolResultPart).toBeTruthy()
    expect(toolResultPart).toMatchObject({
      type: 'tool-result',
      toolCallId: 'orphan-tc',
      state: 'error',
    })
  })

  it('does not inject synthetic result when tool-call has output', () => {
    const input: UIMessage[] = [
      makeUiTextMessage('user-1', 'user', 'do it'),
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'has-output-tc',
            name: 'readFile',
            arguments: '{"path":"a.txt"}',
            state: 'input-complete',
            output: { kind: 'text', text: 'file contents' },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationAsUIMessages(input)
    const assistantMsg = normalized.find((m) => 'parts' in m && m.role === 'assistant') as
      | UIMessage
      | undefined

    const syntheticParts =
      assistantMsg?.parts.filter(
        (p) => p.type === 'tool-result' && p.toolCallId === 'has-output-tc',
      ) ?? []
    expect(syntheticParts).toHaveLength(0)
  })

  it('does not inject synthetic result when matching tool-result part exists', () => {
    const input: UIMessage[] = [
      makeUiTextMessage('user-1', 'user', 'do it'),
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'paired-tc',
            name: 'readFile',
            arguments: '{"path":"a.txt"}',
            state: 'input-complete',
          },
          {
            type: 'tool-result',
            toolCallId: 'paired-tc',
            content: '{"kind":"text","text":"done"}',
            state: 'complete',
          },
        ],
      },
    ]

    const normalized = normalizeContinuationAsUIMessages(input)
    const assistantMsg = normalized.find((m) => 'parts' in m && m.role === 'assistant') as
      | UIMessage
      | undefined

    const toolResultParts =
      assistantMsg?.parts.filter((p) => p.type === 'tool-result' && p.toolCallId === 'paired-tc') ??
      []
    // Only the original tool-result — no synthetic duplicate
    expect(toolResultParts).toHaveLength(1)
    expect(toolResultParts[0]).toMatchObject({ state: 'complete' })
  })

  it('injects synthetic tool-result for approval-responded tool-call without result', () => {
    const input: UIMessage[] = [
      makeUiTextMessage('user-1', 'user', 'do it'),
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'approved-tc',
            name: 'writeFile',
            arguments: '{"path":"b.txt"}',
            state: 'approval-responded',
            approval: { id: 'appr-1', needsApproval: true, approved: true },
          },
        ],
      },
    ]

    const normalized = normalizeContinuationAsUIMessages(input)
    const assistantMsg = normalized.find((m) => 'parts' in m && m.role === 'assistant') as
      | UIMessage
      | undefined

    const syntheticPart = assistantMsg?.parts.find(
      (p) => p.type === 'tool-result' && p.toolCallId === 'approved-tc',
    )
    expect(syntheticPart).toBeTruthy()
    expect(syntheticPart).toMatchObject({ state: 'error' })
  })
})
