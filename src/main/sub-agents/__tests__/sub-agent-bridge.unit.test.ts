import { SubAgentId, TeamId } from '@shared/types/brand'
import type { SubAgentEventPayload, TeamEventPayload } from '@shared/types/sub-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock broadcastToWindows before importing the module under test
// ---------------------------------------------------------------------------

const mockBroadcast = vi.fn()

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => mockBroadcast(...args),
}))

import { emitSubAgentEvent, emitTeamEvent } from '../sub-agent-bridge'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sub-agent-bridge', () => {
  beforeEach(() => {
    mockBroadcast.mockClear()
  })

  describe('emitSubAgentEvent', () => {
    it('broadcasts a sub-agent event on the correct channel', () => {
      const payload: SubAgentEventPayload = {
        agentId: SubAgentId('agent-1'),
        agentName: 'worker',
        eventType: 'started',
        timestamp: 1000,
        data: { agentType: 'general-purpose', depth: 1 },
      }

      emitSubAgentEvent(payload)

      expect(mockBroadcast).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith('sub-agent:event', payload)
    })

    it('includes teamId and data when provided', () => {
      const payload: SubAgentEventPayload = {
        agentId: SubAgentId('agent-2'),
        agentName: 'researcher',
        teamId: 'my-team',
        eventType: 'completed',
        timestamp: 2000,
        data: { turnCount: 5, toolCallCount: 3 },
      }

      emitSubAgentEvent(payload)

      expect(mockBroadcast).toHaveBeenCalledWith('sub-agent:event', payload)
    })
  })

  describe('emitTeamEvent', () => {
    it('broadcasts a team event on the correct channel', () => {
      const payload: TeamEventPayload = {
        teamId: TeamId('team-alpha'),
        eventType: 'team_created',
        timestamp: 3000,
      }

      emitTeamEvent(payload)

      expect(mockBroadcast).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith('team:event', payload)
    })

    it('includes data when provided', () => {
      const payload: TeamEventPayload = {
        teamId: TeamId('team-beta'),
        eventType: 'task_updated',
        timestamp: 4000,
        data: { taskId: '1', status: 'completed' },
      }

      emitTeamEvent(payload)

      expect(mockBroadcast).toHaveBeenCalledWith('team:event', payload)
    })
  })
})
