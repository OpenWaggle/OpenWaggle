import type { Message, MessagePart } from '@shared/types/agent'
import type { ToolCallId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import {
  buildPersistedToolArgsMap,
  describeContinuationMessageFormat,
  enrichContinuationMessages,
  extractDeniedApprovalSnapshot,
  hasNonEmptyToolArgs,
  parseToolArgumentsObject,
  parseToolOutput,
  patchUiToolCallPart,
  restoreContinuationToolArgs,
  type UiToolCallPart,
} from '../agent-continuation'
import type { ContinuationMessage } from '../continuation-normalizer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolCallId(id: string): ToolCallId {
  return id as ToolCallId
}

function makeServerMessage(role: 'user' | 'assistant', parts: MessagePart[]): Message {
  return {
    id: 'msg-1' as Message['id'],
    role,
    parts,
    createdAt: Date.now(),
  }
}

function makeUiMessage(role: 'user' | 'assistant', parts: UIMessage['parts']): UIMessage {
  return {
    id: 'ui-msg-1',
    role,
    parts,
    createdAt: new Date(),
  }
}

function makeModelMessage(role: 'user' | 'assistant', content: string): ContinuationMessage {
  return { role, content }
}

function makeUiToolCallPart(overrides: Partial<UiToolCallPart> = {}): UiToolCallPart {
  return {
    type: 'tool-call',
    id: 'tc-1',
    name: 'readFile',
    arguments: '{"path":"test.ts"}',
    state: 'input-complete',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseToolArgumentsObject
// ---------------------------------------------------------------------------

describe('parseToolArgumentsObject', () => {
  it('returns parsed object and valid=true for valid JSON object', () => {
    const result = parseToolArgumentsObject('{"key":"value","num":42}')
    expect(result.valid).toBe(true)
    expect(result.parsed).toEqual({ key: 'value', num: 42 })
  })

  it('returns empty object and valid=false for invalid JSON', () => {
    const result = parseToolArgumentsObject('not-json')
    expect(result.valid).toBe(false)
    expect(result.parsed).toEqual({})
  })

  it('returns empty object and valid=false for JSON array', () => {
    const result = parseToolArgumentsObject('[1,2,3]')
    expect(result.valid).toBe(false)
    expect(result.parsed).toEqual({})
  })

  it('returns empty object and valid=false for JSON string', () => {
    const result = parseToolArgumentsObject('"hello"')
    expect(result.valid).toBe(false)
    expect(result.parsed).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// hasNonEmptyToolArgs
// ---------------------------------------------------------------------------

describe('hasNonEmptyToolArgs', () => {
  it('returns true for object with keys', () => {
    expect(hasNonEmptyToolArgs({ path: 'file.ts' })).toBe(true)
  })

  it('returns false for empty object', () => {
    expect(hasNonEmptyToolArgs({})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildPersistedToolArgsMap
// ---------------------------------------------------------------------------

describe('buildPersistedToolArgsMap', () => {
  it('extracts tool args from assistant messages with tool-call parts', () => {
    const messages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: makeToolCallId('tc-1'),
            name: 'readFile',
            args: { path: 'README.md' },
          },
        },
      ]),
    ]
    const map = buildPersistedToolArgsMap(messages)
    expect(map.get('tc-1')).toEqual({ path: 'README.md' })
  })

  it('extracts tool args from tool-result parts', () => {
    const messages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-result',
          toolResult: {
            id: makeToolCallId('tc-2'),
            name: 'writeFile',
            args: { path: 'out.txt', content: 'hello' },
            result: 'ok',
            isError: false,
            duration: 50,
          },
        },
      ]),
    ]
    const map = buildPersistedToolArgsMap(messages)
    expect(map.get('tc-2')).toEqual({ path: 'out.txt', content: 'hello' })
  })

  it('skips user messages', () => {
    const messages: Message[] = [makeServerMessage('user', [{ type: 'text', text: 'hi' }])]
    const map = buildPersistedToolArgsMap(messages)
    expect(map.size).toBe(0)
  })

  it('skips tool-call parts with empty args', () => {
    const messages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: makeToolCallId('tc-3'),
            name: 'glob',
            args: {},
          },
        },
      ]),
    ]
    const map = buildPersistedToolArgsMap(messages)
    expect(map.has('tc-3')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// restoreContinuationToolArgs
// ---------------------------------------------------------------------------

describe('restoreContinuationToolArgs', () => {
  it('patches tool-call parts with saved args when args are empty', () => {
    const serverMessages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: makeToolCallId('tc-1'),
            name: 'readFile',
            args: { path: 'file.ts' },
          },
        },
      ]),
    ]

    const finalParts: MessagePart[] = [
      {
        type: 'tool-call',
        toolCall: {
          id: makeToolCallId('tc-1'),
          name: 'readFile',
          args: {},
        },
      },
    ]

    const restored = restoreContinuationToolArgs(finalParts, serverMessages)
    expect(restored[0]).toEqual({
      type: 'tool-call',
      toolCall: {
        id: makeToolCallId('tc-1'),
        name: 'readFile',
        args: { path: 'file.ts' },
      },
    })
  })

  it('skips patching when part already has non-empty args', () => {
    const serverMessages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: makeToolCallId('tc-1'),
            name: 'readFile',
            args: { path: 'old.ts' },
          },
        },
      ]),
    ]

    const finalParts: MessagePart[] = [
      {
        type: 'tool-call',
        toolCall: {
          id: makeToolCallId('tc-1'),
          name: 'readFile',
          args: { path: 'current.ts' },
        },
      },
    ]

    const restored = restoreContinuationToolArgs(finalParts, serverMessages)
    expect(restored[0]).toEqual(finalParts[0])
  })

  it('patches tool-result parts with saved args', () => {
    const serverMessages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-result',
          toolResult: {
            id: makeToolCallId('tc-2'),
            name: 'writeFile',
            args: { path: 'out.txt', content: 'data' },
            result: 'ok',
            isError: false,
            duration: 10,
          },
        },
      ]),
    ]

    const finalParts: MessagePart[] = [
      {
        type: 'tool-result',
        toolResult: {
          id: makeToolCallId('tc-2'),
          name: 'writeFile',
          args: {},
          result: 'ok',
          isError: false,
          duration: 10,
        },
      },
    ]

    const restored = restoreContinuationToolArgs(finalParts, serverMessages)
    const part = restored[0]
    expect(part).toBeDefined()
    if (part?.type === 'tool-result') {
      expect(part.toolResult.args).toEqual({ path: 'out.txt', content: 'data' })
    }
  })

  it('returns a new array even when nothing changes', () => {
    const parts: MessagePart[] = [{ type: 'text', text: 'hello' }]
    const restored = restoreContinuationToolArgs(parts, [])
    expect(restored).not.toBe(parts)
    expect(restored).toEqual(parts)
  })
})

// ---------------------------------------------------------------------------
// describeContinuationMessageFormat
// ---------------------------------------------------------------------------

describe('describeContinuationMessageFormat', () => {
  it('returns "none" for empty array', () => {
    expect(describeContinuationMessageFormat([])).toBe('none')
  })

  it('returns "ui" when all messages are UIMessages (have parts)', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('user', [{ type: 'text', content: 'hi' }]),
    ]
    expect(describeContinuationMessageFormat(messages)).toBe('ui')
  })

  it('returns "model" when all messages are ModelMessages (no parts)', () => {
    const messages: ContinuationMessage[] = [makeModelMessage('user', 'hello')]
    expect(describeContinuationMessageFormat(messages)).toBe('model')
  })

  it('returns "mixed" when both UI and model messages present', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('assistant', [{ type: 'text', content: 'response' }]),
      makeModelMessage('user', 'followup'),
    ]
    expect(describeContinuationMessageFormat(messages)).toBe('mixed')
  })
})

// ---------------------------------------------------------------------------
// extractDeniedApprovalSnapshot
// ---------------------------------------------------------------------------

describe('extractDeniedApprovalSnapshot', () => {
  it('returns null when no denied approvals exist', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-1',
          name: 'readFile',
          arguments: '{"path":"test.ts"}',
          state: 'approval-responded',
          approval: { id: 'tc-1', needsApproval: true, approved: true },
        },
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          content: 'file content',
          state: 'complete',
        },
      ]),
    ]
    expect(extractDeniedApprovalSnapshot(messages)).toBeNull()
  })

  it('finds denied approval by approval.approved === false', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-denied',
          name: 'writeFile',
          arguments: '{"path":"danger.ts","content":"x"}',
          state: 'approval-responded',
          approval: { id: 'tc-denied', needsApproval: true, approved: false },
        },
      ]),
    ]

    const snapshot = extractDeniedApprovalSnapshot(messages)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.toolCallId).toBe('tc-denied')
    expect(snapshot?.toolName).toBe('writeFile')
    expect(snapshot?.message).toBe('User declined tool execution')
  })

  it('finds denied approval by output payload', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-output-denied',
          name: 'runCommand',
          arguments: '{"command":"rm -rf /"}',
          state: 'input-complete',
          output: { approved: false, message: 'Nope, not doing that' },
        },
      ]),
    ]

    const snapshot = extractDeniedApprovalSnapshot(messages)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.toolCallId).toBe('tc-output-denied')
    expect(snapshot?.message).toBe('Nope, not doing that')
  })

  it('skips tool calls that have completed tool results', () => {
    const messages: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-completed',
          name: 'readFile',
          arguments: '{"path":"test.ts"}',
          state: 'input-complete',
          output: { approved: false, message: 'denied' },
        },
      ]),
      makeUiMessage('user', [
        {
          type: 'tool-result',
          toolCallId: 'tc-completed',
          content: 'file content',
          state: 'complete',
        },
      ]),
    ]

    expect(extractDeniedApprovalSnapshot(messages)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(extractDeniedApprovalSnapshot([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseToolOutput
// ---------------------------------------------------------------------------

describe('parseToolOutput', () => {
  it('parses valid JSON and returns parsed value', () => {
    expect(parseToolOutput('{"ok":true}')).toEqual({ ok: true })
  })

  it('parses JSON array', () => {
    expect(parseToolOutput('[1,2]')).toEqual([1, 2])
  })

  it('returns raw string on invalid JSON', () => {
    expect(parseToolOutput('not-json')).toBe('not-json')
  })

  it('returns raw string when JSON parse throws', () => {
    expect(parseToolOutput('{broken')).toBe('{broken')
  })
})

// ---------------------------------------------------------------------------
// patchUiToolCallPart
// ---------------------------------------------------------------------------

describe('patchUiToolCallPart', () => {
  it('updates arguments immutably', () => {
    const original = makeUiToolCallPart()
    const patched = patchUiToolCallPart(original, {
      arguments: '{"newPath":"updated.ts"}',
    })

    expect(patched.arguments).toBe('{"newPath":"updated.ts"}')
    expect(original.arguments).toBe('{"path":"test.ts"}')
    expect(patched).not.toBe(original)
  })

  it('updates output immutably', () => {
    const original = makeUiToolCallPart()
    const patched = patchUiToolCallPart(original, { output: 'tool result' })

    expect(patched.output).toBe('tool result')
  })

  it('sets output to undefined when explicitly provided', () => {
    const original = makeUiToolCallPart({ output: 'existing' })
    const patched = patchUiToolCallPart(original, { output: undefined })

    expect(patched.output).toBeUndefined()
  })

  it('preserves original when no updates match', () => {
    const original = makeUiToolCallPart()
    const patched = patchUiToolCallPart(original, {})

    expect(patched.arguments).toBe(original.arguments)
    expect(patched).not.toBe(original)
  })
})

// ---------------------------------------------------------------------------
// enrichContinuationMessages
// ---------------------------------------------------------------------------

describe('enrichContinuationMessages', () => {
  it('restores args from server messages into UI tool-call parts', () => {
    const serverMessages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: makeToolCallId('tc-1'),
            name: 'readFile',
            args: { path: 'restored.ts' },
          },
        },
      ]),
    ]

    const normalized: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-1',
          name: 'readFile',
          arguments: '{}',
          state: 'input-complete',
        },
      ]),
    ]

    const enriched = enrichContinuationMessages(normalized, serverMessages)
    const msg = enriched[0]
    if (msg && 'parts' in msg) {
      const part = msg.parts[0]
      if (part?.type === 'tool-call') {
        expect(part.arguments).toBe('{"path":"restored.ts"}')
      }
    }
  })

  it('restores output from server tool-result parts', () => {
    const serverMessages: Message[] = [
      makeServerMessage('assistant', [
        {
          type: 'tool-result',
          toolResult: {
            id: makeToolCallId('tc-1'),
            name: 'readFile',
            args: {},
            result: '{"content":"hello"}',
            isError: false,
            duration: 10,
          },
        },
      ]),
    ]

    const normalized: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-1',
          name: 'readFile',
          arguments: '{}',
          state: 'input-complete',
        },
      ]),
    ]

    const enriched = enrichContinuationMessages(normalized, serverMessages)
    const msg = enriched[0]
    if (msg && 'parts' in msg) {
      const part = msg.parts[0]
      if (part?.type === 'tool-call') {
        expect(part.output).toEqual({ content: 'hello' })
      }
    }
  })

  it('synthesizes skipped output for approved tool in non-last assistant message', () => {
    const normalized: ContinuationMessage[] = [
      makeUiMessage('assistant', [
        {
          type: 'tool-call',
          id: 'tc-old',
          name: 'readFile',
          arguments: '{}',
          state: 'approval-responded',
          approval: { id: 'tc-old', needsApproval: true, approved: true },
        },
      ]),
      makeUiMessage('user', [{ type: 'text', content: 'next message' }]),
      makeUiMessage('assistant', [{ type: 'text', content: 'response' }]),
    ]

    const enriched = enrichContinuationMessages(normalized, [])
    const msg = enriched[0]
    if (msg && 'parts' in msg) {
      const part = msg.parts[0]
      if (part?.type === 'tool-call') {
        expect(part.output).toBe('Tool execution was skipped because a new message was sent.')
      }
    }
  })

  it('passes through non-assistant messages unchanged', () => {
    const userMessage = makeUiMessage('user', [{ type: 'text', content: 'hi' }])
    const normalized: ContinuationMessage[] = [userMessage]

    const enriched = enrichContinuationMessages(normalized, [])
    expect(enriched[0]).toBe(userMessage)
  })

  it('passes through model messages unchanged', () => {
    const modelMsg = makeModelMessage('assistant', 'hello')
    const normalized: ContinuationMessage[] = [modelMsg]

    const enriched = enrichContinuationMessages(normalized, [])
    expect(enriched[0]).toBe(modelMsg)
  })
})
