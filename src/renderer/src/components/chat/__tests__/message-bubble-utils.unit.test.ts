import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import {
  countToolCallParts,
  getLastRenderableTextPartIndex,
  hasRenderableTextPartBeforeIndex,
  isRenderableTextPart,
} from '../message-bubble-utils'

type MessagePart = UIMessage['parts'][number]

function textPart(content: string): MessagePart {
  return { type: 'text', content }
}

function toolCallPart(name: string, id = 'tc-1'): MessagePart {
  return {
    type: 'tool-call',
    id,
    name,
    arguments: '{}',
    state: 'output-available',
  }
}

describe('isRenderableTextPart', () => {
  it('returns true for non-empty text part', () => {
    expect(isRenderableTextPart(textPart('hello'))).toBe(true)
  })

  it('returns false for empty text part', () => {
    expect(isRenderableTextPart(textPart(''))).toBe(false)
  })

  it('returns false for whitespace-only text part', () => {
    expect(isRenderableTextPart(textPart('   \n\t  '))).toBe(false)
  })

  it('returns false for non-text part', () => {
    expect(isRenderableTextPart(toolCallPart('read'))).toBe(false)
  })
})

describe('getLastRenderableTextPartIndex', () => {
  it('returns index of the last non-empty text part', () => {
    const parts: UIMessage['parts'] = [textPart('first'), toolCallPart('run'), textPart('last')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(2)
  })

  it('skips trailing empty text parts', () => {
    const parts: UIMessage['parts'] = [textPart('only'), textPart('')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(0)
  })

  it('returns -1 when no renderable text parts exist', () => {
    const parts: UIMessage['parts'] = [toolCallPart('run'), textPart('')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(-1)
  })

  it('returns -1 for empty parts array', () => {
    expect(getLastRenderableTextPartIndex([])).toBe(-1)
  })
})

describe('countToolCallParts', () => {
  it('counts tool-call parts correctly', () => {
    const parts: UIMessage['parts'] = [
      textPart('hi'),
      toolCallPart('read', 'tc-1'),
      toolCallPart('write', 'tc-2'),
    ]
    expect(countToolCallParts(parts)).toBe(2)
  })

  it('returns 0 when no tool-call parts exist', () => {
    const parts: UIMessage['parts'] = [textPart('hello')]
    expect(countToolCallParts(parts)).toBe(0)
  })
})

describe('hasRenderableTextPartBeforeIndex', () => {
  it('returns true when a renderable text part exists before index', () => {
    const parts: UIMessage['parts'] = [textPart('first'), toolCallPart('run'), textPart('last')]
    expect(hasRenderableTextPartBeforeIndex(parts, 2)).toBe(true)
  })

  it('returns false when no renderable text part exists before index', () => {
    const parts: UIMessage['parts'] = [toolCallPart('run'), textPart('only')]
    expect(hasRenderableTextPartBeforeIndex(parts, 1)).toBe(false)
  })

  it('returns false when index is 0', () => {
    const parts: UIMessage['parts'] = [textPart('first')]
    expect(hasRenderableTextPartBeforeIndex(parts, 0)).toBe(false)
  })

  it('returns false when index is negative', () => {
    const parts: UIMessage['parts'] = [textPart('first')]
    expect(hasRenderableTextPartBeforeIndex(parts, -1)).toBe(false)
  })
})
