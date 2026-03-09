import { ConversationId, OrchestrationRunId, SupportedModelId } from '@shared/types/brand'
import type { StreamChunk } from '@tanstack/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../broadcast', () => ({
  broadcastToWindows: vi.fn(),
}))

vi.mock('../../agent/phase-tracker', () => ({
  updatePhaseFromStreamChunk: vi.fn(),
  updatePhaseFromOrchestrationEvent: vi.fn(),
  resetPhaseForConversation: vi.fn(),
}))

import {
  resetPhaseForConversation,
  updatePhaseFromOrchestrationEvent,
  updatePhaseFromStreamChunk,
} from '../../agent/phase-tracker'
import { broadcastToWindows } from '../broadcast'
import {
  clearAgentPhase,
  emitOrchestrationEvent,
  emitStreamChunk,
  emitWaggleStreamChunk,
  emitWaggleTurnEvent,
} from '../stream-bridge'

const conversationId = ConversationId('test-conv-1')

describe('stream-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── emitStreamChunk ─────────────────────────────────────
  describe('emitStreamChunk', () => {
    it('broadcasts a TEXT_MESSAGE_CONTENT chunk on agent:stream-chunk', () => {
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: false, phase: null })

      const chunk: StreamChunk = {
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: 1000,
        messageId: 'm1',
        delta: 'hello',
      }

      emitStreamChunk(conversationId, chunk)

      expect(broadcastToWindows).toHaveBeenCalledWith('agent:stream-chunk', {
        conversationId,
        chunk,
      })
    })

    it('calls updatePhaseFromStreamChunk with the chunk', () => {
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: false, phase: null })

      const chunk: StreamChunk = {
        type: 'RUN_STARTED',
        timestamp: 1000,
        runId: 'r1',
      }

      emitStreamChunk(conversationId, chunk)

      expect(updatePhaseFromStreamChunk).toHaveBeenCalledWith(
        conversationId,
        chunk,
        expect.any(Number),
      )
    })

    it('emits phase event when phase changes', () => {
      const phaseState = { label: 'Thinking' as const, startedAt: 1000 }
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: true, phase: phaseState })

      const chunk: StreamChunk = {
        type: 'RUN_STARTED',
        timestamp: 1000,
        runId: 'r1',
      }

      emitStreamChunk(conversationId, chunk)

      expect(broadcastToWindows).toHaveBeenCalledWith('agent:phase', {
        conversationId,
        phase: phaseState,
      })
    })

    it('does not emit phase event when phase is unchanged', () => {
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: false, phase: null })

      const chunk: StreamChunk = {
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: 1000,
        messageId: 'm1',
        delta: 'text',
      }

      emitStreamChunk(conversationId, chunk)

      // Only the stream-chunk broadcast should fire, not agent:phase
      expect(broadcastToWindows).toHaveBeenCalledTimes(1)
      expect(broadcastToWindows).toHaveBeenCalledWith(
        'agent:stream-chunk',
        expect.objectContaining({ conversationId }),
      )
    })

    it('serializes RUN_ERROR chunks with error object normalization', () => {
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: false, phase: null })

      // Runtime RUN_ERROR errors can carry name/stack beyond the typed { message; code? }.
      // Build via Object.assign to avoid excess-property checks on the literal.
      const baseError = { message: 'something failed', code: 'PROVIDER_ERROR' }
      const errorWithExtras = Object.assign(baseError, {
        name: 'TestError',
        stack: 'TestError: something failed\n    at test.ts:1',
      })

      const chunk: StreamChunk = {
        type: 'RUN_ERROR',
        timestamp: 1000,
        error: errorWithExtras,
      }

      emitStreamChunk(conversationId, chunk)

      const broadcastCall = vi.mocked(broadcastToWindows).mock.calls[0]
      expect(broadcastCall[0]).toBe('agent:stream-chunk')
      const payload = broadcastCall[1] as { conversationId: string; chunk: StreamChunk }
      const sentChunk = payload.chunk

      expect(sentChunk.type).toBe('RUN_ERROR')
      if (sentChunk.type === 'RUN_ERROR') {
        expect(sentChunk.error.message).toBe('something failed')
        expect('name' in sentChunk.error && sentChunk.error.name).toBe('TestError')
        expect('stack' in sentChunk.error && sentChunk.error.stack).toBe(
          'TestError: something failed\n    at test.ts:1',
        )
        expect('code' in sentChunk.error && sentChunk.error.code).toBe('PROVIDER_ERROR')
      }
    })

    it('serializes RUN_ERROR with minimal error (message only)', () => {
      vi.mocked(updatePhaseFromStreamChunk).mockReturnValue({ changed: false, phase: null })

      const chunk: StreamChunk = {
        type: 'RUN_ERROR',
        timestamp: 1000,
        error: { message: 'bare error' },
      }

      emitStreamChunk(conversationId, chunk)

      const broadcastCall = vi.mocked(broadcastToWindows).mock.calls[0]
      const payload = broadcastCall[1] as { conversationId: string; chunk: StreamChunk }
      const sentChunk = payload.chunk

      if (sentChunk.type === 'RUN_ERROR') {
        expect(sentChunk.error.message).toBe('bare error')
        expect('name' in sentChunk.error).toBe(false)
        expect('stack' in sentChunk.error).toBe(false)
      }
    })
  })

  // ─── emitOrchestrationEvent ──────────────────────────────
  describe('emitOrchestrationEvent', () => {
    it('broadcasts the payload on orchestration:event', () => {
      vi.mocked(updatePhaseFromOrchestrationEvent).mockReturnValue({
        changed: false,
        phase: null,
      })

      const payload = {
        conversationId,
        runId: OrchestrationRunId('run-1'),
        type: 'run_started' as const,
        at: new Date().toISOString(),
      }

      emitOrchestrationEvent(payload)

      expect(broadcastToWindows).toHaveBeenCalledWith('orchestration:event', payload)
    })

    it('emits phase event when orchestration phase changes', () => {
      const phaseState = { label: 'Planning' as const, startedAt: 2000 }
      vi.mocked(updatePhaseFromOrchestrationEvent).mockReturnValue({
        changed: true,
        phase: phaseState,
      })

      const payload = {
        conversationId,
        runId: OrchestrationRunId('run-1'),
        type: 'run_started' as const,
        at: new Date().toISOString(),
      }

      emitOrchestrationEvent(payload)

      expect(broadcastToWindows).toHaveBeenCalledWith('agent:phase', {
        conversationId,
        phase: phaseState,
      })
    })
  })

  // ─── emitWaggleStreamChunk ───────────────────────────────
  describe('emitWaggleStreamChunk', () => {
    it('broadcasts on waggle:stream-chunk with chunk and metadata', () => {
      const chunk: StreamChunk = {
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: 1000,
        messageId: 'm1',
        delta: 'waggle text',
      }
      const meta = {
        agentIndex: 0,
        agentLabel: 'Agent A',
        agentColor: 'blue' as const,
        agentModel: SupportedModelId('claude-3.5-sonnet'),
        turnNumber: 1,
        collaborationMode: 'sequential' as const,
      }

      emitWaggleStreamChunk(conversationId, chunk, meta)

      expect(broadcastToWindows).toHaveBeenCalledWith('waggle:stream-chunk', {
        conversationId,
        chunk,
        meta,
      })
    })

    it('serializes RUN_ERROR in waggle chunks', () => {
      const baseError = { message: 'waggle error' }
      const errorObj = Object.assign(baseError, {
        name: 'WaggleError',
        stack: 'stack trace',
      })
      const chunk: StreamChunk = {
        type: 'RUN_ERROR',
        timestamp: 1000,
        error: errorObj,
      }
      const meta = {
        agentIndex: 1,
        agentLabel: 'Agent B',
        agentColor: 'amber' as const,
        agentModel: SupportedModelId('gpt-4'),
        turnNumber: 0,
        collaborationMode: 'sequential' as const,
      }

      emitWaggleStreamChunk(conversationId, chunk, meta)

      const broadcastCall = vi.mocked(broadcastToWindows).mock.calls[0]
      const payload = broadcastCall[1] as {
        chunk: StreamChunk
      }

      if (payload.chunk.type === 'RUN_ERROR') {
        expect(payload.chunk.error.message).toBe('waggle error')
        expect('name' in payload.chunk.error && payload.chunk.error.name).toBe('WaggleError')
      }
    })
  })

  // ─── emitWaggleTurnEvent ─────────────────────────────────
  describe('emitWaggleTurnEvent', () => {
    it('broadcasts on waggle:turn-event with conversationId and event', () => {
      const event = {
        type: 'turn-start' as const,
        turnNumber: 2,
        agentIndex: 0,
        agentLabel: 'Agent A',
      }

      emitWaggleTurnEvent(conversationId, event)

      expect(broadcastToWindows).toHaveBeenCalledWith('waggle:turn-event', {
        conversationId,
        event,
      })
    })
  })

  // ─── clearAgentPhase ─────────────────────────────────────
  describe('clearAgentPhase', () => {
    it('emits phase null when resetPhaseForConversation reports changed', () => {
      vi.mocked(resetPhaseForConversation).mockReturnValue({ changed: true, phase: null })

      clearAgentPhase(conversationId)

      expect(resetPhaseForConversation).toHaveBeenCalledWith(conversationId)
      expect(broadcastToWindows).toHaveBeenCalledWith('agent:phase', {
        conversationId,
        phase: null,
      })
    })

    it('does NOT broadcast when phase was already cleared', () => {
      vi.mocked(resetPhaseForConversation).mockReturnValue({ changed: false, phase: null })

      clearAgentPhase(conversationId)

      expect(resetPhaseForConversation).toHaveBeenCalledWith(conversationId)
      expect(broadcastToWindows).not.toHaveBeenCalled()
    })
  })
})
