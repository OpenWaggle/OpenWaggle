import { ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  extractTextFromParts,
  hasToolCallNamed,
  isTextPart,
  isToolCallPart,
  type MessagePart,
} from '../agent'

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
    expect(isTextPart(toolCallPart('readFile'))).toBe(false)
    expect(isTextPart(reasoningPart('thinking'))).toBe(false)
  })
})

describe('isToolCallPart', () => {
  it('returns true for tool-call parts', () => {
    expect(isToolCallPart(toolCallPart('readFile'))).toBe(true)
  })

  it('returns false for non-tool-call parts', () => {
    expect(isToolCallPart(textPart('hello'))).toBe(false)
  })
})

describe('hasToolCallNamed', () => {
  it('returns true when a tool call with the given name exists', () => {
    const parts = [textPart('analysis'), toolCallPart('proposePlan')]
    expect(hasToolCallNamed(parts, 'proposePlan')).toBe(true)
  })

  it('returns false when no tool call with the given name exists', () => {
    const parts = [textPart('analysis'), toolCallPart('readFile')]
    expect(hasToolCallNamed(parts, 'proposePlan')).toBe(false)
  })

  it('returns false for empty parts', () => {
    expect(hasToolCallNamed([], 'proposePlan')).toBe(false)
  })
})

describe('extractTextFromParts', () => {
  it('concatenates text parts with newlines', () => {
    const parts = [textPart('line 1'), textPart('line 2')]
    expect(extractTextFromParts(parts)).toBe('line 1\nline 2')
  })

  it('ignores non-text parts', () => {
    const parts = [textPart('hello'), toolCallPart('readFile'), reasoningPart('hmm')]
    expect(extractTextFromParts(parts)).toBe('hello')
  })

  it('returns empty string for no text parts', () => {
    const parts = [toolCallPart('readFile')]
    expect(extractTextFromParts(parts)).toBe('')
  })
})
