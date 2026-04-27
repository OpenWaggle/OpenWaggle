import { ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { isTextPart, isToolCallPart, type MessagePart } from '../agent'

function textPart(text: string): MessagePart {
  return { type: 'text', text }
}

function toolCallPart(name: string, id = 'tc-1'): MessagePart {
  return {
    type: 'tool-call',
    toolCall: { id: ToolCallId(id), name, args: {} },
  }
}

function reasoningPart(text: string): MessagePart {
  return { type: 'reasoning', text }
}

describe('isTextPart', () => {
  it('returns true for text parts', () => {
    expect(isTextPart(textPart('hello'))).toBe(true)
  })

  it('returns false for non-text parts', () => {
    expect(isTextPart(toolCallPart('read'))).toBe(false)
    expect(isTextPart(reasoningPart('thinking'))).toBe(false)
  })
})

describe('isToolCallPart', () => {
  it('returns true for tool-call parts', () => {
    expect(isToolCallPart(toolCallPart('read'))).toBe(true)
  })

  it('returns false for non-tool-call parts', () => {
    expect(isToolCallPart(textPart('hello'))).toBe(false)
  })
})
