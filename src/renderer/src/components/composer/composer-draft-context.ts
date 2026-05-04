import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'

export interface ComposerDraftContextInput {
  readonly projectPath: string | null
  readonly sessionId: SessionId | null
  readonly activeBranchId?: SessionBranchId | null
  readonly activeNodeId?: SessionNodeId | null
  readonly draftSourceNodeId?: SessionNodeId | null
}

function normalizeProjectPath(projectPath: string | null): string {
  const trimmed = projectPath?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'no-project'
}

export function buildComposerDraftContextKey(input: ComposerDraftContextInput): string {
  const projectKey = `project:${normalizeProjectPath(input.projectPath)}`
  if (!input.sessionId) {
    return `${projectKey}:new-session`
  }

  const sessionKey = `${projectKey}:session:${String(input.sessionId)}`
  if (input.draftSourceNodeId) {
    return `${sessionKey}:draft:${String(input.draftSourceNodeId)}`
  }
  if (input.activeBranchId) {
    return `${sessionKey}:branch:${String(input.activeBranchId)}`
  }
  if (input.activeNodeId) {
    return `${sessionKey}:node:${String(input.activeNodeId)}`
  }
  return `${sessionKey}:main`
}
