import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import type { AgentMessage } from '@shared/types/team'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must precede module-under-test import
// ---------------------------------------------------------------------------

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../../tools/context-injection-buffer', () => ({
  pushContext: vi.fn(),
}))

// Import after mocks are in place
import { pushContext } from '../../tools/context-injection-buffer'
import {
  clearAgentMessages,
  clearAllMessages,
  deliverPendingMessages,
  getPendingMessageCount,
  handleShutdownResponse,
  loadPendingMessages,
  persistPendingMessages,
  sendAgentMessage,
  sendShutdownRequest,
  subscribe,
} from '../message-bus'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testConversationId = ConversationId('test-conv-1')

function makeHandler(): (msg: AgentMessage) => void {
  return vi.fn()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('message-bus', () => {
  beforeEach(() => {
    clearAllMessages()
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // subscribe + direct message delivery
  // -----------------------------------------------------------------------

  describe('subscribe + sendAgentMessage (direct)', () => {
    it('delivers a message to a subscribed handler', () => {
      const handler = makeHandler()
      subscribe('agent-a', handler)

      sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'hello',
      })

      expect(handler).toHaveBeenCalledOnce()
      const received = vi.mocked(handler).mock.calls[0][0]
      expect(received.type).toBe('message')
      expect(received.sender).toBe('agent-b')
      expect(received.recipient).toBe('agent-a')
      expect(received.content).toBe('hello')
      expect(received.timestamp).toBeGreaterThan(0)
      expect(received.requestId).toEqual(expect.any(String))
    })

    it('returns a non-empty requestId', () => {
      subscribe('agent-a', makeHandler())

      const requestId = sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'test',
      })

      expect(requestId).toEqual(expect.any(String))
      expect(requestId.length).toBeGreaterThan(0)
    })

    it('preserves a caller-supplied requestId', () => {
      subscribe('agent-a', makeHandler())

      const requestId = sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'test',
        requestId: 'custom-id',
      })

      expect(requestId).toBe('custom-id')
    })
  })

  // -----------------------------------------------------------------------
  // Queuing when no subscriber
  // -----------------------------------------------------------------------

  describe('message queuing (no subscriber)', () => {
    it('queues a message when recipient has no subscription', () => {
      sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'queued',
      })

      expect(getPendingMessageCount('agent-a')).toBe(1)
    })

    it('queues multiple messages', () => {
      sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'first',
      })
      sendAgentMessage({
        type: 'message',
        sender: 'agent-c',
        recipient: 'agent-a',
        content: 'second',
      })

      expect(getPendingMessageCount('agent-a')).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // getPendingMessageCount
  // -----------------------------------------------------------------------

  describe('getPendingMessageCount', () => {
    it('returns 0 for unknown agent', () => {
      expect(getPendingMessageCount('nonexistent')).toBe(0)
    })

    it('reflects queued message count', () => {
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'y',
        content: 'a',
      })

      expect(getPendingMessageCount('y')).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Unsubscribe
  // -----------------------------------------------------------------------

  describe('unsubscribe', () => {
    it('removes handler so subsequent messages are queued', () => {
      const handler = makeHandler()
      const unsub = subscribe('agent-a', handler)

      unsub()

      sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        recipient: 'agent-a',
        content: 'after-unsub',
      })

      expect(handler).not.toHaveBeenCalled()
      expect(getPendingMessageCount('agent-a')).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  describe('broadcast', () => {
    it('sends to all subscribed agents except sender', () => {
      const handlerA = makeHandler()
      const handlerB = makeHandler()
      const handlerC = makeHandler()

      subscribe('agent-a', handlerA)
      subscribe('agent-b', handlerB)
      subscribe('agent-c', handlerC)

      sendAgentMessage({
        type: 'broadcast',
        sender: 'agent-a',
        content: 'hello all',
      })

      expect(handlerA).not.toHaveBeenCalled()
      expect(handlerB).toHaveBeenCalledOnce()
      expect(handlerC).toHaveBeenCalledOnce()

      // Each recipient gets the message with their name as recipient
      const msgB = vi.mocked(handlerB).mock.calls[0][0]
      expect(msgB.recipient).toBe('agent-b')

      const msgC = vi.mocked(handlerC).mock.calls[0][0]
      expect(msgC.recipient).toBe('agent-c')
    })

    it('returns requestId for broadcast', () => {
      subscribe('agent-a', makeHandler())

      const requestId = sendAgentMessage({
        type: 'broadcast',
        sender: 'agent-b',
        content: 'broadcast msg',
      })

      expect(requestId).toEqual(expect.any(String))
      expect(requestId.length).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // No recipient for non-broadcast type
  // -----------------------------------------------------------------------

  describe('sendAgentMessage without recipient (non-broadcast)', () => {
    it('returns empty string and does not deliver', () => {
      const handler = makeHandler()
      subscribe('agent-a', handler)

      const requestId = sendAgentMessage({
        type: 'message',
        sender: 'agent-b',
        content: 'no recipient',
      })

      expect(requestId).toBe('')
      expect(handler).not.toHaveBeenCalled()
      expect(getPendingMessageCount('agent-a')).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Shutdown request/response
  // -----------------------------------------------------------------------

  describe('sendShutdownRequest + handleShutdownResponse', () => {
    it('resolves with approved: true', async () => {
      const handler = makeHandler()
      subscribe('worker', handler)

      const promise = sendShutdownRequest('coordinator', 'worker', 'please stop')

      // Handler receives the shutdown_request
      expect(handler).toHaveBeenCalledOnce()
      const msg = vi.mocked(handler).mock.calls[0][0]
      expect(msg.type).toBe('shutdown_request')
      expect(msg.sender).toBe('coordinator')
      expect(msg.recipient).toBe('worker')
      expect(msg.requestId).toEqual(expect.any(String))

      // Respond to the shutdown request
      handleShutdownResponse(msg.requestId ?? '', true)

      const result = await promise
      expect(result).toEqual({ approved: true, reason: undefined })
    })

    it('resolves with approved: false and a reason', async () => {
      const handler = makeHandler()
      subscribe('worker', handler)

      const promise = sendShutdownRequest('coordinator', 'worker', 'stop now')
      const msg = vi.mocked(handler).mock.calls[0][0]

      handleShutdownResponse(msg.requestId ?? '', false, 'still working')

      const result = await promise
      expect(result).toEqual({ approved: false, reason: 'still working' })
    })

    it('does nothing when requestId is unknown', () => {
      // Should not throw
      handleShutdownResponse('nonexistent-id', true)
    })
  })

  // -----------------------------------------------------------------------
  // deliverPendingMessages
  // -----------------------------------------------------------------------

  describe('deliverPendingMessages', () => {
    it('delivers queued messages via pushContext', () => {
      sendAgentMessage({
        type: 'message',
        sender: 'coordinator',
        recipient: 'worker',
        content: 'do task A',
      })
      sendAgentMessage({
        type: 'message',
        sender: 'coordinator',
        recipient: 'worker',
        content: 'do task B',
        requestId: 'req-b',
      })

      const count = deliverPendingMessages('worker', testConversationId)

      expect(count).toBe(2)
      expect(pushContext).toHaveBeenCalledTimes(2)

      // Verify formatted message structure
      const firstCall = vi.mocked(pushContext).mock.calls[0]
      expect(firstCall[0]).toBe(testConversationId)
      expect(firstCall[1]).toContain('<agent_message type="message" from="coordinator">')
      expect(firstCall[1]).toContain('do task A')
      expect(firstCall[1]).toContain('</agent_message>')

      const secondCall = vi.mocked(pushContext).mock.calls[1]
      expect(secondCall[1]).toContain('Request ID: req-b')
      expect(secondCall[1]).toContain('do task B')
    })

    it('includes Approved field when approve is set', () => {
      sendAgentMessage({
        type: 'plan_approval_response',
        sender: 'coordinator',
        recipient: 'worker',
        content: 'approved',
        approve: true,
      })

      deliverPendingMessages('worker', testConversationId)

      const formatted = vi.mocked(pushContext).mock.calls[0][1]
      expect(formatted).toContain('Approved: true')
    })

    it('returns 0 when no pending messages', () => {
      const count = deliverPendingMessages('worker', testConversationId)
      expect(count).toBe(0)
      expect(pushContext).not.toHaveBeenCalled()
    })

    it('clears pending messages after delivery', () => {
      sendAgentMessage({
        type: 'message',
        sender: 'coordinator',
        recipient: 'worker',
        content: 'task',
      })

      deliverPendingMessages('worker', testConversationId)
      expect(getPendingMessageCount('worker')).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // clearAgentMessages
  // -----------------------------------------------------------------------

  describe('clearAgentMessages', () => {
    it('clears subscription and pending messages for a specific agent', () => {
      const handler = makeHandler()
      subscribe('agent-a', handler)
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-a',
        content: 'will be cleared',
      })

      // agent-a has a handler, so message was delivered (not queued)
      expect(handler).toHaveBeenCalledOnce()

      // Now queue a message by unsubscribing first, then sending
      const unsub = subscribe('agent-a', makeHandler())
      unsub()
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-a',
        content: 'queued',
      })
      expect(getPendingMessageCount('agent-a')).toBe(1)

      // Re-subscribe then clear
      subscribe('agent-a', makeHandler())
      clearAgentMessages('agent-a')

      // Pending messages cleared
      expect(getPendingMessageCount('agent-a')).toBe(0)

      // Subscription cleared — new messages should be queued
      sendAgentMessage({
        type: 'message',
        sender: 'y',
        recipient: 'agent-a',
        content: 'after clear',
      })
      expect(getPendingMessageCount('agent-a')).toBe(1)
    })

    it('does not affect other agents', () => {
      const handlerB = makeHandler()
      subscribe('agent-b', handlerB)

      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-c',
        content: 'for c',
      })

      clearAgentMessages('agent-a')

      // agent-b still subscribed
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-b',
        content: 'still works',
      })
      expect(handlerB).toHaveBeenCalledOnce()

      // agent-c pending unaffected
      expect(getPendingMessageCount('agent-c')).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // clearAllMessages
  // -----------------------------------------------------------------------

  describe('clearAllMessages', () => {
    it('clears all subscriptions, pending messages, and shutdown callbacks', () => {
      const handlerA = makeHandler()
      const handlerB = makeHandler()
      subscribe('agent-a', handlerA)
      subscribe('agent-b', handlerB)

      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-c',
        content: 'queued',
      })

      clearAllMessages()

      // Subscriptions gone — messages should be queued
      sendAgentMessage({
        type: 'message',
        sender: 'y',
        recipient: 'agent-a',
        content: 'after clear',
      })
      expect(handlerA).not.toHaveBeenCalled()
      expect(getPendingMessageCount('agent-a')).toBe(1)

      // Previous pending cleared
      expect(getPendingMessageCount('agent-c')).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Handler error resilience
  // -----------------------------------------------------------------------

  describe('handler error resilience', () => {
    it('catches handler errors without crashing', () => {
      subscribe('agent-a', () => {
        throw new Error('handler boom')
      })

      // Should not throw
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'agent-a',
        content: 'trigger error',
      })
    })

    it('catches broadcast handler errors without affecting other handlers', () => {
      subscribe('agent-a', () => {
        throw new Error('handler boom')
      })
      const handlerB = makeHandler()
      subscribe('agent-b', handlerB)

      sendAgentMessage({
        type: 'broadcast',
        sender: 'agent-c',
        content: 'broadcast with error',
      })

      // agent-b still receives the broadcast despite agent-a throwing
      expect(handlerB).toHaveBeenCalledOnce()
    })
  })

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  describe('persistence', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'message-bus-test-'))
    })

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('persist/load round-trip restores pending messages', async () => {
      // Queue messages to offline agents
      sendAgentMessage({
        type: 'message',
        sender: 'coordinator',
        recipient: 'worker-1',
        content: 'do task A',
      })
      sendAgentMessage({
        type: 'message',
        sender: 'coordinator',
        recipient: 'worker-2',
        content: 'do task B',
      })

      await persistPendingMessages(tmpDir, 'test-team')
      clearAllMessages()

      expect(getPendingMessageCount('worker-1')).toBe(0)
      expect(getPendingMessageCount('worker-2')).toBe(0)

      const loaded = await loadPendingMessages(tmpDir, 'test-team')
      expect(loaded).toBe(true)

      expect(getPendingMessageCount('worker-1')).toBe(1)
      expect(getPendingMessageCount('worker-2')).toBe(1)
    })

    it('ENOENT returns false', async () => {
      const result = await loadPendingMessages(tmpDir, 'nonexistent-team')
      expect(result).toBe(false)
    })

    it('corrupt file returns false', async () => {
      const dir = path.join(tmpDir, '.openwaggle', 'teams', 'corrupt')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'pending-messages.json'), '{{bad json', 'utf8')

      const result = await loadPendingMessages(tmpDir, 'corrupt')
      expect(result).toBe(false)
    })

    it('only pending messages are persisted, not subscriptions or callbacks', async () => {
      // Set up a subscription (should not be persisted)
      subscribe('agent-a', makeHandler())

      // Queue a pending message
      sendAgentMessage({
        type: 'message',
        sender: 'x',
        recipient: 'offline-agent',
        content: 'queued msg',
      })

      await persistPendingMessages(tmpDir, 'test-team')

      const filePath = path.join(
        tmpDir,
        '.openwaggle',
        'teams',
        'test-team',
        'pending-messages.json',
      )
      const raw = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(raw) as { pending: Record<string, unknown[]> }

      // Only the pending queue should be present
      expect(data.pending).toBeDefined()
      expect(data.pending['offline-agent']).toHaveLength(1)
      // agent-a has a subscription, not pending messages
      expect(data.pending['agent-a']).toBeUndefined()
    })
  })
})
