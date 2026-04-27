import type { UIMessage } from '@shared/types/chat-ui'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMessageCollapse } from '../hooks/useMessageCollapse'

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

function createMessage(id: string, parts: MessagePart[]): UIMessage {
  return { id, role: 'assistant', parts }
}

describe('useMessageCollapse', () => {
  describe('canCollapseToSynthesis', () => {
    it('is true when not streaming, has last text part, and has tool calls', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary here')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.canCollapseToSynthesis).toBe(true)
    })

    it('is false when streaming', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary here')])
      const { result } = renderHook(() => useMessageCollapse(message, true, true))
      expect(result.current.canCollapseToSynthesis).toBe(false)
    })

    it('is false when no renderable text part exists', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.canCollapseToSynthesis).toBe(false)
    })

    it('is false when only a single text part with no tool calls', () => {
      const message = createMessage('m1', [textPart('Just text')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.canCollapseToSynthesis).toBe(false)
    })
  })

  describe('showDetails and toggleDetails', () => {
    it('starts with showDetails false', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.showDetails).toBe(false)
    })

    it('toggles showDetails to true then back to false', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))

      act(() => result.current.toggleDetails())
      expect(result.current.showDetails).toBe(true)

      act(() => result.current.toggleDetails())
      expect(result.current.showDetails).toBe(false)
    })
  })

  describe('renderAllParts', () => {
    it('is true when streaming', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary')])
      const { result } = renderHook(() => useMessageCollapse(message, true, true))
      expect(result.current.renderAllParts).toBe(true)
    })

    it('is false when completed and canCollapse', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.canCollapseToSynthesis).toBe(true)
      expect(result.current.renderAllParts).toBe(false)
    })

    it('is true when completed but cannot collapse', () => {
      const message = createMessage('m1', [textPart('Just text')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.renderAllParts).toBe(true)
    })
  })

  describe('collapseLabel', () => {
    it('shows "Show N tool calls" with correct count', () => {
      const message = createMessage('m1', [
        toolCallPart('read', 'tc-1'),
        toolCallPart('write', 'tc-2'),
        textPart('Done'),
      ])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.collapseLabel).toBe('Show 2 tool calls')
    })

    it('shows singular "tool call" for count of 1', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Done')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.collapseLabel).toBe('Show 1 tool call')
    })

    it('shows "Show details" when no tool calls but has earlier text parts', () => {
      const message = createMessage('m1', [textPart('First'), textPart('Second')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.collapseLabel).toBe('Show details')
    })
  })

  describe('lastRenderableTextPartIndex', () => {
    it('returns correct index of the last renderable text part', () => {
      const message = createMessage('m1', [
        textPart('First'),
        toolCallPart('read', 'tc-1'),
        textPart('Last'),
      ])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.lastRenderableTextPartIndex).toBe(2)
    })

    it('returns -1 when no renderable text parts', () => {
      const message = createMessage('m1', [toolCallPart('read', 'tc-1')])
      const { result } = renderHook(() => useMessageCollapse(message, false, false))
      expect(result.current.lastRenderableTextPartIndex).toBe(-1)
    })
  })
})
