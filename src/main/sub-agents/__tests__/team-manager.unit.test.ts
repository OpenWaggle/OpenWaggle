import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SubAgentId } from '@shared/types/brand'
import type { TeamMember } from '@shared/types/team'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../task-board', () => ({
  deleteBoard: vi.fn(),
}))

const mockEmitTeamEvent = vi.fn()
vi.mock('../sub-agent-bridge', () => ({
  emitTeamEvent: (...args: unknown[]) => mockEmitTeamEvent(...args),
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

// ---------------------------------------------------------------------------
// Import the module under test after mocks are in place.
// ---------------------------------------------------------------------------

import { resetAppRuntimeForTests } from '../../runtime'
import { writeTeamRuntimeState } from '../../services/team-runtime-state'
import {
  addTeamMember,
  clearAllTeams,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  loadPersistedTeam,
  persistTeamConfig,
  updateMemberStatus,
} from '../team-manager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    name: 'worker-1',
    agentId: SubAgentId('agent-001'),
    agentType: 'executor',
    status: 'active',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team-manager', () => {
  beforeEach(async () => {
    await resetAppRuntimeForTests()
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-manager-db-'))
    clearAllTeams()
    mockEmitTeamEvent.mockClear()
  })

  afterEach(async () => {
    await resetAppRuntimeForTests()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  // ── createTeam ──────────────────────────────────────────────────────────

  describe('createTeam', () => {
    it('creates a team with a TeamId derived from the name and empty members', () => {
      const team = createTeam('alpha')

      expect(team.id).toBe('alpha')
      expect(team.name).toBe('alpha')
      expect(team.members).toEqual([])
      expect(team.createdAt).toBeGreaterThan(0)
    })

    it('stores the optional description', () => {
      const team = createTeam('alpha', 'A test team')

      expect(team.description).toBe('A test team')
    })

    it('leaves description undefined when not provided', () => {
      const team = createTeam('alpha')

      expect(team.description).toBeUndefined()
    })

    it('throws when a team with the same name already exists', () => {
      createTeam('alpha')

      expect(() => createTeam('alpha')).toThrow('Team "alpha" already exists')
    })
  })

  // ── getTeam ─────────────────────────────────────────────────────────────

  describe('getTeam', () => {
    it('returns a previously created team', () => {
      createTeam('alpha')

      const team = getTeam('alpha')

      expect(team).toBeDefined()
      expect(team?.name).toBe('alpha')
    })

    it('returns undefined for an unknown team name', () => {
      expect(getTeam('nonexistent')).toBeUndefined()
    })
  })

  // ── addTeamMember ───────────────────────────────────────────────────────

  describe('addTeamMember', () => {
    it('adds a member to the team and returns the updated team', () => {
      createTeam('alpha')
      const member = makeMember()

      const updated = addTeamMember('alpha', member)

      expect(updated.members).toHaveLength(1)
      expect(updated.members[0].name).toBe('worker-1')
      expect(updated.members[0].agentId).toBe('agent-001')
    })

    it('appends multiple members', () => {
      createTeam('alpha')

      addTeamMember('alpha', makeMember({ name: 'worker-1', agentId: SubAgentId('a-1') }))
      const updated = addTeamMember(
        'alpha',
        makeMember({ name: 'worker-2', agentId: SubAgentId('a-2') }),
      )

      expect(updated.members).toHaveLength(2)
    })

    it('throws when the team does not exist', () => {
      expect(() => addTeamMember('nonexistent', makeMember())).toThrow(
        'Team "nonexistent" not found',
      )
    })

    it('throws when a member with the same name already exists in the team', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ name: 'worker-1' }))

      expect(() => addTeamMember('alpha', makeMember({ name: 'worker-1' }))).toThrow(
        'Member "worker-1" already exists in team "alpha"',
      )
    })
  })

  // ── updateMemberStatus ──────────────────────────────────────────────────

  describe('updateMemberStatus', () => {
    it('updates the status of a matching member by agentId', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ agentId: SubAgentId('a-1'), status: 'active' }))

      updateMemberStatus('alpha', SubAgentId('a-1'), 'idle')

      const team = getTeam('alpha')
      expect(team?.members[0].status).toBe('idle')
    })

    it('does not modify other members when updating one', () => {
      createTeam('alpha')
      addTeamMember(
        'alpha',
        makeMember({ name: 'worker-1', agentId: SubAgentId('a-1'), status: 'active' }),
      )
      addTeamMember(
        'alpha',
        makeMember({ name: 'worker-2', agentId: SubAgentId('a-2'), status: 'active' }),
      )

      updateMemberStatus('alpha', SubAgentId('a-1'), 'shutdown')

      const team = getTeam('alpha')
      expect(team?.members[0].status).toBe('shutdown')
      expect(team?.members[1].status).toBe('active')
    })

    it('does nothing when the team does not exist', () => {
      // updateMemberStatus silently returns for unknown teams
      expect(() => updateMemberStatus('nonexistent', SubAgentId('a-1'), 'idle')).not.toThrow()
    })

    it('does nothing when no member matches the agentId', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ agentId: SubAgentId('a-1'), status: 'active' }))

      updateMemberStatus('alpha', SubAgentId('unknown-agent'), 'shutdown')

      const team = getTeam('alpha')
      expect(team?.members[0].status).toBe('active')
    })
  })

  // ── deleteTeam ──────────────────────────────────────────────────────────

  describe('deleteTeam', () => {
    it('throws when the team does not exist', () => {
      expect(() => deleteTeam('nonexistent')).toThrow('Team "nonexistent" not found')
    })

    it('throws when active members remain', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ status: 'active' }))

      expect(() => deleteTeam('alpha')).toThrow(
        'Cannot delete team "alpha" \u2014 1 member(s) still active',
      )
    })

    it('throws when idle members remain (not shutdown)', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ status: 'idle' }))

      expect(() => deleteTeam('alpha')).toThrow('still active')
    })

    it('succeeds when all members are shutdown', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ status: 'shutdown' }))

      expect(() => deleteTeam('alpha')).not.toThrow()
      expect(getTeam('alpha')).toBeUndefined()
    })

    it('succeeds when the team has no members', () => {
      createTeam('alpha')

      expect(() => deleteTeam('alpha')).not.toThrow()
      expect(getTeam('alpha')).toBeUndefined()
    })

    it('removes the team from listTeams after deletion', () => {
      createTeam('alpha')
      createTeam('beta')

      deleteTeam('alpha')

      const names = listTeams().map((t) => t.name)
      expect(names).not.toContain('alpha')
      expect(names).toContain('beta')
    })
  })

  // ── listTeams ───────────────────────────────────────────────────────────

  describe('listTeams', () => {
    it('returns an empty array when no teams exist', () => {
      expect(listTeams()).toEqual([])
    })

    it('returns all created teams', () => {
      createTeam('alpha')
      createTeam('beta')
      createTeam('gamma')

      const teams = listTeams()
      const names = teams.map((t) => t.name)

      expect(teams).toHaveLength(3)
      expect(names).toContain('alpha')
      expect(names).toContain('beta')
      expect(names).toContain('gamma')
    })
  })

  // ── clearAllTeams ───────────────────────────────────────────────────────

  describe('clearAllTeams', () => {
    it('removes all teams', () => {
      createTeam('alpha')
      createTeam('beta')

      clearAllTeams()

      expect(listTeams()).toEqual([])
    })

    it('is safe to call when no teams exist', () => {
      expect(() => clearAllTeams()).not.toThrow()
      expect(listTeams()).toEqual([])
    })
  })

  // ── IPC event emissions ────────────────────────────────────────────────

  describe('IPC event emissions', () => {
    it('emits team_created when a team is created', () => {
      createTeam('alpha', 'Test team')

      expect(mockEmitTeamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'alpha',
          eventType: 'team_created',
          data: { description: 'Test team' },
        }),
      )
    })

    it('emits member_joined when a member is added', () => {
      createTeam('alpha')
      mockEmitTeamEvent.mockClear()

      addTeamMember('alpha', makeMember({ name: 'bot-1', agentType: 'executor' }))

      expect(mockEmitTeamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'alpha',
          eventType: 'member_joined',
          data: { memberName: 'bot-1', agentType: 'executor' },
        }),
      )
    })

    it('emits member_shutdown when a member status is set to shutdown', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ agentId: SubAgentId('a-1'), status: 'active' }))
      mockEmitTeamEvent.mockClear()

      updateMemberStatus('alpha', SubAgentId('a-1'), 'shutdown')

      expect(mockEmitTeamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'alpha',
          eventType: 'member_shutdown',
          data: { agentId: 'a-1' },
        }),
      )
    })

    it('does not emit member_shutdown for non-shutdown status changes', () => {
      createTeam('alpha')
      addTeamMember('alpha', makeMember({ agentId: SubAgentId('a-1'), status: 'active' }))
      mockEmitTeamEvent.mockClear()

      updateMemberStatus('alpha', SubAgentId('a-1'), 'idle')

      expect(mockEmitTeamEvent).not.toHaveBeenCalled()
    })

    it('emits team_deleted when a team is deleted', () => {
      createTeam('alpha')
      mockEmitTeamEvent.mockClear()

      deleteTeam('alpha')

      expect(mockEmitTeamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'alpha',
          eventType: 'team_deleted',
        }),
      )
    })
  })

  // ── loadPersistedTeam ─────────────────────────────────────────────────

  describe('loadPersistedTeam', () => {
    it('loads a valid config from disk and populates the teams map', async () => {
      createTeam('my-team', 'A persisted team')
      addTeamMember('my-team', makeMember({ name: 'worker-1', agentId: SubAgentId('agent-001') }))
      addTeamMember(
        'my-team',
        makeMember({ name: 'worker-2', agentId: SubAgentId('agent-002'), agentType: 'researcher' }),
      )
      await persistTeamConfig('/project', 'my-team')
      clearAllTeams()

      const result = await loadPersistedTeam('/project', 'my-team')

      expect(result).toBe(true)
      const team = getTeam('my-team')
      expect(team).toBeDefined()
      expect(team?.name).toBe('my-team')
      expect(team?.description).toBe('A persisted team')
      expect(team?.members).toHaveLength(2)
    })

    it('sets all loaded members to shutdown status', async () => {
      createTeam('my-team', 'A persisted team')
      addTeamMember('my-team', makeMember({ name: 'worker-1', agentId: SubAgentId('agent-001') }))
      await persistTeamConfig('/project', 'my-team')
      clearAllTeams()

      await loadPersistedTeam('/project', 'my-team')

      const team = getTeam('my-team')
      for (const member of team?.members ?? []) {
        expect(member.status).toBe('shutdown')
      }
    })

    it('returns false for ENOENT without throwing', async () => {
      const result = await loadPersistedTeam('/project', 'missing-team')

      expect(result).toBe(false)
      expect(getTeam('missing-team')).toBeUndefined()
    })

    it('returns false for invalid JSON config without throwing', async () => {
      await writeTeamRuntimeState({
        projectPath: '/project',
        teamName: 'bad-team',
        teamConfigJson: 'not valid json {{{',
      })

      const result = await loadPersistedTeam('/project', 'bad-team')

      expect(result).toBe(false)
      expect(getTeam('bad-team')).toBeUndefined()
    })
  })
})
