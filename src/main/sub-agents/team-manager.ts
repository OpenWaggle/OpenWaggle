import fs from 'node:fs/promises'
import path from 'node:path'
import { SubAgentId, TeamId } from '@shared/types/brand'
import type { TeamMember, TeamMemberStatus, TeamRecord } from '@shared/types/team'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { z } from 'zod'
import { createLogger } from '../logger'
import { atomicWriteJSON } from '../utils/atomic-write'
import { emitTeamEvent } from './sub-agent-bridge'
import { deleteBoard } from './task-board'

const logger = createLogger('team-manager')

const teams = new Map<string, TeamRecord>()

export function createTeam(name: string, description?: string): TeamRecord {
  if (teams.has(name)) {
    throw new Error(`Team "${name}" already exists`)
  }

  const team: TeamRecord = {
    id: TeamId(name),
    name,
    description,
    members: [],
    createdAt: Date.now(),
  }

  teams.set(name, team)

  emitTeamEvent({
    teamId: TeamId(name),
    eventType: 'team_created',
    timestamp: Date.now(),
    data: { description },
  })

  logger.info('Team created', { name, description })
  return team
}

export function getTeam(name: string): TeamRecord | undefined {
  return teams.get(name)
}

export function addTeamMember(teamName: string, member: TeamMember): TeamRecord {
  const team = teams.get(teamName)
  if (!team) {
    throw new Error(`Team "${teamName}" not found`)
  }

  const existing = team.members.find((m) => m.name === member.name)
  if (existing) {
    throw new Error(`Member "${member.name}" already exists in team "${teamName}"`)
  }

  const updated: TeamRecord = {
    ...team,
    members: [...team.members, member],
  }
  teams.set(teamName, updated)

  emitTeamEvent({
    teamId: TeamId(teamName),
    eventType: 'member_joined',
    timestamp: Date.now(),
    data: { memberName: member.name, agentType: member.agentType },
  })

  logger.info('Member added to team', {
    teamName,
    memberName: member.name,
    agentType: member.agentType,
  })

  return updated
}

export function updateMemberStatus(
  teamName: string,
  agentId: SubAgentId,
  status: TeamMemberStatus,
): void {
  const team = teams.get(teamName)
  if (!team) return

  const updated: TeamRecord = {
    ...team,
    members: team.members.map((m) => (m.agentId === agentId ? { ...m, status } : m)),
  }
  teams.set(teamName, updated)

  if (status === 'shutdown') {
    emitTeamEvent({
      teamId: TeamId(teamName),
      eventType: 'member_shutdown',
      timestamp: Date.now(),
      data: { agentId },
    })
  }
}

export function deleteTeam(name: string): void {
  const team = teams.get(name)
  if (!team) {
    throw new Error(`Team "${name}" not found`)
  }

  const activeMembers = team.members.filter((m) => m.status !== 'shutdown')
  if (activeMembers.length > 0) {
    throw new Error(
      `Cannot delete team "${name}" — ${String(activeMembers.length)} member(s) still active. Shut them down first.`,
    )
  }

  teams.delete(name)
  deleteBoard(name)

  emitTeamEvent({
    teamId: TeamId(name),
    eventType: 'team_deleted',
    timestamp: Date.now(),
  })

  logger.info('Team deleted', { name })
}

export async function persistTeamConfig(projectPath: string, teamName: string): Promise<void> {
  const team = teams.get(teamName)
  if (!team) return

  const configDir = path.join(projectPath, '.openwaggle', 'teams', teamName)
  await fs.mkdir(configDir, { recursive: true })

  const configPath = path.join(configDir, 'config.json')
  const config = {
    id: team.id,
    name: team.name,
    description: team.description,
    members: team.members.map((m) => ({
      name: m.name,
      agentId: m.agentId,
      agentType: m.agentType,
    })),
    createdAt: team.createdAt,
  }

  await atomicWriteJSON(configPath, config)
  logger.info('Team config persisted', { teamName, configPath })
}

export async function cleanupTeamConfig(projectPath: string, teamName: string): Promise<void> {
  const configDir = path.join(projectPath, '.openwaggle', 'teams', teamName)
  try {
    await fs.rm(configDir, { recursive: true })
    logger.info('Team config cleaned up', { teamName })
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('Failed to cleanup team config', {
        teamName,
        error: formatErrorMessage(error),
      })
    }
  }
}

// ── Persisted Team Loading ──────────────────────────────────

const persistedMemberSchema = z.object({
  name: z.string(),
  agentId: z.string(),
  agentType: z.string(),
})

const persistedTeamConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  members: z.array(persistedMemberSchema),
  createdAt: z.number(),
})

export async function loadPersistedTeam(projectPath: string, teamName: string): Promise<boolean> {
  const configPath = path.join(projectPath, '.openwaggle', 'teams', teamName, 'config.json')
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const config = persistedTeamConfigSchema.parse(parsed)

    const team: TeamRecord = {
      id: TeamId(config.id),
      name: config.name,
      description: config.description,
      members: config.members.map(
        (m): TeamMember => ({
          name: m.name,
          agentId: SubAgentId(m.agentId),
          agentType: m.agentType,
          status: 'shutdown',
        }),
      ),
      createdAt: config.createdAt,
    }

    teams.set(teamName, team)
    logger.info('Loaded persisted team', { teamName, memberCount: team.members.length })
    return true
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('Failed to load persisted team config', {
        teamName,
        error: formatErrorMessage(error),
      })
    }
    return false
  }
}

export function listTeams(): readonly TeamRecord[] {
  return [...teams.values()]
}

export function clearAllTeams(): void {
  teams.clear()
}
