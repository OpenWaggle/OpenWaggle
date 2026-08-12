import { isRecord } from './openwaggle-mcp-server-policy'
import type {
  HostedDerivedWorktreeMetadata,
  HostedOwnedSessionMetadata,
  HostedSessionWorktreeMetadata,
  HostedSessionWorktreePlanMetadata,
  SessionControlMetadata,
  SessionHandoffMetadata,
} from './openwaggle-mcp-session-metadata-store'

interface CommonWorktreeMetadata {
  readonly projectPath: string
  readonly branch: string
  readonly baseRef: string
  readonly requestedBaseRef: string | null
  readonly startFromOrigin: boolean
  readonly createdAt: number
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function nullableStringValue(value: unknown) {
  return typeof value === 'string' || value === null ? value : undefined
}

function commonWorktreeMetadata(value: unknown): CommonWorktreeMetadata | null {
  if (!isRecord(value)) return null
  const projectPath = stringValue(value.projectPath)
  const branch = stringValue(value.branch)
  const baseRef = stringValue(value.baseRef)
  const requestedBaseRef = nullableStringValue(value.requestedBaseRef)
  const startFromOrigin = booleanValue(value.startFromOrigin)
  const createdAt = numberValue(value.createdAt)
  if (
    projectPath === undefined ||
    branch === undefined ||
    baseRef === undefined ||
    requestedBaseRef === undefined ||
    startFromOrigin === undefined ||
    createdAt === undefined
  ) {
    return null
  }
  return { projectPath, branch, baseRef, requestedBaseRef, startFromOrigin, createdAt }
}

function parseHandoff(value: unknown): SessionHandoffMetadata | undefined {
  if (!isRecord(value)) return undefined
  const summary = stringValue(value.summary)
  const createdAt = numberValue(value.createdAt)
  const createdByProfile = stringValue(value.createdByProfile)
  if (summary === undefined || createdAt === undefined || createdByProfile === undefined) {
    return undefined
  }
  return {
    summary,
    createdAt,
    createdByProfile,
    ...(typeof value.originSessionId === 'string'
      ? { originSessionId: value.originSessionId }
      : {}),
  }
}

function parseWorktreePlan(value: unknown): HostedSessionWorktreePlanMetadata | undefined {
  if (!isRecord(value)) return undefined
  const baseRef = nullableStringValue(value.baseRef)
  const startFromOrigin = booleanValue(value.startFromOrigin)
  return baseRef === undefined || startFromOrigin === undefined
    ? undefined
    : { baseRef, startFromOrigin }
}

function parseWorktree(value: unknown): HostedSessionWorktreeMetadata | undefined {
  if (!isRecord(value)) return undefined
  const common = commonWorktreeMetadata(value)
  const sourceSessionId = stringValue(value.sourceSessionId)
  const sourceProjectPath = stringValue(value.sourceProjectPath)
  if (!common || sourceSessionId === undefined || sourceProjectPath === undefined) return undefined
  return { sourceSessionId, sourceProjectPath, ...common }
}

function parseDerivedWorktree(value: unknown): HostedDerivedWorktreeMetadata | undefined {
  if (!isRecord(value)) return undefined
  const common = commonWorktreeMetadata(value)
  const sessionId = stringValue(value.sessionId)
  return common && sessionId !== undefined ? { sessionId, ...common } : undefined
}

function parseOwnedSession(value: unknown): HostedOwnedSessionMetadata | undefined {
  if (!isRecord(value)) return undefined
  const profile = stringValue(value.profile)
  const projectPath = nullableStringValue(value.projectPath)
  const createdAt = numberValue(value.createdAt)
  const validSourceSession =
    value.sourceSessionId === undefined || typeof value.sourceSessionId === 'string'
  const validSourceProject =
    value.sourceProjectPath === undefined ||
    typeof value.sourceProjectPath === 'string' ||
    value.sourceProjectPath === null
  if (
    profile === undefined ||
    projectPath === undefined ||
    createdAt === undefined ||
    !validSourceSession ||
    !validSourceProject
  ) {
    return undefined
  }
  return {
    profile,
    projectPath,
    createdAt,
    ...(typeof value.sourceSessionId === 'string'
      ? { sourceSessionId: value.sourceSessionId }
      : {}),
    ...(typeof value.sourceProjectPath === 'string' || value.sourceProjectPath === null
      ? { sourceProjectPath: value.sourceProjectPath }
      : {}),
  }
}

export function parseSessionControlMetadata(value: unknown): SessionControlMetadata | null {
  if (!isRecord(value)) return null
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.pinned !== 'boolean' ||
    typeof value.depth !== 'number' ||
    !Number.isInteger(value.depth) ||
    value.depth < 0 ||
    typeof value.updatedAt !== 'number'
  ) {
    return null
  }
  const handoff = parseHandoff(value.handoff)
  const worktreePlan = parseWorktreePlan(value.worktreePlan)
  const worktree = parseWorktree(value.worktree)
  const derivedWorktree = parseDerivedWorktree(value.derivedWorktree)
  const ownedSession = parseOwnedSession(value.ownedSession)
  return {
    sessionId: value.sessionId,
    pinned: value.pinned,
    depth: value.depth,
    updatedAt: value.updatedAt,
    ...(handoff ? { handoff } : {}),
    ...(worktreePlan ? { worktreePlan } : {}),
    ...(worktree ? { worktree } : {}),
    ...(derivedWorktree ? { derivedWorktree } : {}),
    ...(ownedSession ? { ownedSession } : {}),
  }
}
