import { ConversationId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyContextInjection,
  clearContext,
  drainContext,
  hasContext,
  pushContext,
} from '../context-injection-buffer'
import type { NormalizedToolResult } from '../define-tool'

const CONV_A = ConversationId('conv-a')
const CONV_B = ConversationId('conv-b')

describe('context-injection-buffer', () => {
  beforeEach(() => {
    clearContext(CONV_A)
    clearContext(CONV_B)
  })

  describe('pushContext + drainContext', () => {
    it('returns buffered items and clears the buffer', () => {
      pushContext(CONV_A, 'first message')
      pushContext(CONV_A, 'second message')

      const items = drainContext(CONV_A)
      expect(items).toHaveLength(2)
      expect(items[0].text).toBe('first message')
      expect(items[1].text).toBe('second message')
      expect(items[0].timestamp).toBeGreaterThan(0)

      // Buffer should be empty after drain
      expect(drainContext(CONV_A)).toEqual([])
    })
  })

  describe('drainContext', () => {
    it('returns empty array when buffer has no items', () => {
      expect(drainContext(CONV_A)).toEqual([])
    })
  })

  describe('clearContext', () => {
    it('empties pending items', () => {
      pushContext(CONV_A, 'msg')
      clearContext(CONV_A)
      expect(drainContext(CONV_A)).toEqual([])
    })

    it('is a no-op on empty buffer', () => {
      clearContext(CONV_A)
      expect(drainContext(CONV_A)).toEqual([])
    })
  })

  describe('hasContext', () => {
    it('returns false when buffer is empty', () => {
      expect(hasContext(CONV_A)).toBe(false)
    })

    it('returns true when buffer has items', () => {
      pushContext(CONV_A, 'msg')
      expect(hasContext(CONV_A)).toBe(true)
    })

    it('returns false after drain', () => {
      pushContext(CONV_A, 'msg')
      drainContext(CONV_A)
      expect(hasContext(CONV_A)).toBe(false)
    })
  })

  describe('conversation isolation', () => {
    it('buffers are independent per conversation', () => {
      pushContext(CONV_A, 'msg-a')
      pushContext(CONV_B, 'msg-b')

      const itemsA = drainContext(CONV_A)
      expect(itemsA).toHaveLength(1)
      expect(itemsA[0].text).toBe('msg-a')

      const itemsB = drainContext(CONV_B)
      expect(itemsB).toHaveLength(1)
      expect(itemsB[0].text).toBe('msg-b')
    })

    it('clearing one conversation does not affect another', () => {
      pushContext(CONV_A, 'msg-a')
      pushContext(CONV_B, 'msg-b')

      clearContext(CONV_A)

      expect(hasContext(CONV_A)).toBe(false)
      expect(hasContext(CONV_B)).toBe(true)
    })
  })

  describe('applyContextInjection', () => {
    it('returns result unchanged when buffer is empty', () => {
      const result = applyContextInjection(CONV_A, 'tool output')
      expect(result.result).toBe('tool output')
      expect(result.injectedItems).toEqual([])
    })

    it('appends <user_context_update> tag to string results', () => {
      pushContext(CONV_A, 'please use TypeScript')
      const result = applyContextInjection(CONV_A, 'file created')

      expect(typeof result.result).toBe('string')
      expect(result.result).toContain('file created')
      expect(result.result).toContain('<user_context_update>')
      expect(result.result).toContain('please use TypeScript')
      expect(result.injectedItems).toHaveLength(1)
    })

    it('appends tag to NormalizedToolResult text kind', () => {
      pushContext(CONV_A, 'hint')
      const input: NormalizedToolResult = { kind: 'text', text: 'base output' }
      const result = applyContextInjection(CONV_A, input)

      expect(typeof result.result).toBe('object')
      const textResult = result.result as NormalizedToolResult
      expect(textResult.kind).toBe('text')
      if (textResult.kind === 'text') {
        expect(textResult.text).toContain('base output')
        expect(textResult.text).toContain('<user_context_update>')
      }
    })

    it('converts JSON results to text when injecting', () => {
      pushContext(CONV_A, 'context msg')
      const input: NormalizedToolResult = { kind: 'json', data: { count: 42 } }
      const result = applyContextInjection(CONV_A, input)

      const textResult = result.result as NormalizedToolResult
      expect(textResult.kind).toBe('text')
      if (textResult.kind === 'text') {
        expect(textResult.text).toContain('{"count":42}')
        expect(textResult.text).toContain('<user_context_update>')
      }
    })

    it('includes multiple messages in single tag', () => {
      pushContext(CONV_A, 'first')
      pushContext(CONV_A, 'second')
      const result = applyContextInjection(CONV_A, 'output')

      expect(result.injectedItems).toHaveLength(2)
      const text = result.result as string
      expect(text).toContain('first')
      expect(text).toContain('second')
      // Only one tag block, not two
      const tagCount = (text.match(/<user_context_update>/g) ?? []).length
      expect(tagCount).toBe(1)
    })

    it('drains the buffer after injection', () => {
      pushContext(CONV_A, 'msg')
      applyContextInjection(CONV_A, 'output')
      expect(hasContext(CONV_A)).toBe(false)
    })
  })
})
