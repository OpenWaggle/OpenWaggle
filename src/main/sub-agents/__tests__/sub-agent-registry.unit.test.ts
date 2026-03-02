import type { Message } from '@shared/types/agent'
import { ConversationId, MessageId, SubAgentId } from '@shared/types/brand'
import type { SubAgentResult } from '@shared/types/sub-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the logger — avoids console noise during the test run.
// ---------------------------------------------------------------------------

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import type { SubAgentEntry } from '../sub-agent-registry'
import {
  clearSubAgentRegistry,
  countBackgroundAgents,
  getConversationSnapshot,
  getSubAgent,
  listActiveSubAgents,
  listSubAgentsByTeam,
  registerSubAgent,
  storeConversationSnapshot,
  updateSubAgent,
} from '../sub-agent-registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SubAgentEntry> = {}): SubAgentEntry {
  return {
    agentId: SubAgentId('agent-1'),
    name: 'Test Agent',
    agentType: 'coder',
    conversationId: ConversationId('conv-1'),
    parentConversationId: ConversationId('parent-conv-1'),
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  }
}

function makeMessage(id: string, text: string): Message {
  return {
    id: MessageId(id),
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sub-agent-registry', () => {
  beforeEach(() => {
    clearSubAgentRegistry()
  })

  // ── registerSubAgent / getSubAgent ─────────────────────────

  describe('registerSubAgent + getSubAgent', () => {
    it('stores an entry and retrieves it by agentId', () => {
      const entry = makeEntry()
      registerSubAgent(entry)

      const retrieved = getSubAgent(entry.agentId)
      expect(retrieved).toEqual(entry)
    })

    it('overwrites when registering the same agentId twice', () => {
      const entry1 = makeEntry({ name: 'First' })
      const entry2 = makeEntry({ name: 'Second' })

      registerSubAgent(entry1)
      registerSubAgent(entry2)

      expect(getSubAgent(entry1.agentId)?.name).toBe('Second')
    })
  })

  // ── getSubAgent — unknown ──────────────────────────────────

  describe('getSubAgent — unknown id', () => {
    it('returns undefined for an unregistered agentId', () => {
      expect(getSubAgent(SubAgentId('nonexistent'))).toBeUndefined()
    })
  })

  // ── updateSubAgent ─────────────────────────────────────────

  describe('updateSubAgent', () => {
    it('merges update fields into an existing entry', () => {
      const entry = makeEntry({ status: 'running' })
      registerSubAgent(entry)

      updateSubAgent(entry.agentId, { status: 'completed', completedAt: 999 })

      const updated = getSubAgent(entry.agentId)
      expect(updated?.status).toBe('completed')
      expect(updated?.completedAt).toBe(999)
      // Unchanged fields are preserved
      expect(updated?.name).toBe(entry.name)
    })

    it('does nothing for an unknown agentId', () => {
      const unknownId = SubAgentId('unknown')
      // Should not throw
      updateSubAgent(unknownId, { status: 'failed' })
      expect(getSubAgent(unknownId)).toBeUndefined()
    })

    it('can attach a result via update', () => {
      const entry = makeEntry()
      registerSubAgent(entry)

      const result: SubAgentResult = {
        agentId: entry.agentId,
        status: 'completed',
        output: 'Done',
        turnCount: 3,
        toolCallCount: 5,
      }
      updateSubAgent(entry.agentId, { result })

      expect(getSubAgent(entry.agentId)?.result).toEqual(result)
    })
  })

  // ── storeConversationSnapshot / getConversationSnapshot ────

  describe('storeConversationSnapshot + getConversationSnapshot', () => {
    it('round-trips messages for a known agent', () => {
      const entry = makeEntry()
      registerSubAgent(entry)

      const messages: readonly Message[] = [makeMessage('m1', 'Hello'), makeMessage('m2', 'World')]

      storeConversationSnapshot(entry.agentId, messages)
      const snapshot = getConversationSnapshot(entry.agentId)

      expect(snapshot).toEqual(messages)
      expect(snapshot).toHaveLength(2)
    })

    it('overwrites previous snapshot', () => {
      const entry = makeEntry()
      registerSubAgent(entry)

      storeConversationSnapshot(entry.agentId, [makeMessage('m1', 'First')])
      storeConversationSnapshot(entry.agentId, [makeMessage('m2', 'Second')])

      const snapshot = getConversationSnapshot(entry.agentId)
      expect(snapshot).toHaveLength(1)
      expect(snapshot?.[0]?.parts[0]).toEqual({ type: 'text', text: 'Second' })
    })

    it('does nothing when agent is unknown', () => {
      const unknownId = SubAgentId('unknown')
      storeConversationSnapshot(unknownId, [makeMessage('m1', 'Hi')])
      expect(getConversationSnapshot(unknownId)).toBeUndefined()
    })
  })

  describe('getConversationSnapshot — unknown agent', () => {
    it('returns undefined for an unregistered agentId', () => {
      expect(getConversationSnapshot(SubAgentId('nonexistent'))).toBeUndefined()
    })
  })

  // ── listSubAgentsByTeam ────────────────────────────────────

  describe('listSubAgentsByTeam', () => {
    it('returns only agents matching the given teamId', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), teamId: 'team-alpha' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), teamId: 'team-beta' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a3'), teamId: 'team-alpha' }))

      const alphaAgents = listSubAgentsByTeam('team-alpha')
      expect(alphaAgents).toHaveLength(2)

      const ids = alphaAgents.map((a) => a.agentId)
      expect(ids).toContain(SubAgentId('a1'))
      expect(ids).toContain(SubAgentId('a3'))
    })

    it('returns empty array when no agents match', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), teamId: 'team-alpha' }))
      expect(listSubAgentsByTeam('team-gamma')).toEqual([])
    })

    it('excludes agents with no teamId', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1') }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), teamId: 'team-alpha' }))

      expect(listSubAgentsByTeam('team-alpha')).toHaveLength(1)
    })
  })

  // ── listActiveSubAgents ────────────────────────────────────

  describe('listActiveSubAgents', () => {
    it('returns agents with status running or idle', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), status: 'running' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), status: 'idle' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a3'), status: 'completed' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a4'), status: 'failed' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a5'), status: 'shutdown' }))

      const active = listActiveSubAgents()
      expect(active).toHaveLength(2)

      const ids = active.map((a) => a.agentId)
      expect(ids).toContain(SubAgentId('a1'))
      expect(ids).toContain(SubAgentId('a2'))
    })

    it('returns empty array when no agents are active', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), status: 'completed' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), status: 'failed' }))

      expect(listActiveSubAgents()).toEqual([])
    })

    it('returns empty array when registry is empty', () => {
      expect(listActiveSubAgents()).toEqual([])
    })
  })

  // ── countBackgroundAgents ──────────────────────────────────

  describe('countBackgroundAgents', () => {
    it('counts only agents with status running', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), status: 'running' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), status: 'running' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a3'), status: 'idle' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a4'), status: 'completed' }))

      expect(countBackgroundAgents()).toBe(2)
    })

    it('returns 0 when no agents are running', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1'), status: 'idle' }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2'), status: 'completed' }))

      expect(countBackgroundAgents()).toBe(0)
    })

    it('returns 0 when registry is empty', () => {
      expect(countBackgroundAgents()).toBe(0)
    })
  })

  // ── clearSubAgentRegistry ──────────────────────────────────

  describe('clearSubAgentRegistry', () => {
    it('removes all registered agents', () => {
      registerSubAgent(makeEntry({ agentId: SubAgentId('a1') }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a2') }))
      registerSubAgent(makeEntry({ agentId: SubAgentId('a3') }))

      clearSubAgentRegistry()

      expect(getSubAgent(SubAgentId('a1'))).toBeUndefined()
      expect(getSubAgent(SubAgentId('a2'))).toBeUndefined()
      expect(getSubAgent(SubAgentId('a3'))).toBeUndefined()
      expect(listActiveSubAgents()).toEqual([])
      expect(countBackgroundAgents()).toBe(0)
    })

    it('is safe to call on an empty registry', () => {
      clearSubAgentRegistry()
      expect(listActiveSubAgents()).toEqual([])
    })
  })
})
