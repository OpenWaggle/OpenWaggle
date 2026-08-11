import { MCP_CONFIG } from '@shared/constants/mcp'
import type { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail, SessionWorktreePlan } from '@shared/types/session'
import { z } from 'zod'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'

export const MAX_SESSION_PAGE_SIZE = 100
export const DEFAULT_SESSION_PAGE_SIZE = 40
export const MAX_WAIT_MS = 30_000
export const DEFAULT_WAIT_MS = 5_000
export const MAX_HANDOFF_SUMMARY_BYTES = 64_000

export const sessionInputSchema = z.object({
  operation: z.enum([
    'list',
    'status',
    'read',
    'create',
    'plan-worktree',
    'create-worktree',
    'fork',
    'clone',
    'message',
    'steer',
    'wait',
    'interrupt',
    'handoff',
    'rename',
    'pin',
    'unpin',
    'archive',
    'unarchive',
  ]),
  sessionId: z.string().optional(),
  projectPath: z.string().optional(),
  title: z.string().optional(),
  objective: z.string().optional(),
  handoffSummary: z.string().optional(),
  targetNodeId: z.string().optional(),
  environmentMode: z.enum(['local', 'worktree']).optional(),
  baseRef: z.string().nullable().optional(),
  startFromOrigin: z.boolean().optional(),
  timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).optional(),
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_SESSION_PAGE_SIZE).optional(),
})

export type SessionToolInput = z.infer<typeof sessionInputSchema>

export interface OpenWaggleSessionToolAdapters {
  readonly materializeWorktree: (session: SessionDetail) => Promise<string>
  readonly loadSession?: (sessionId: string) => Promise<SessionDetail>
  readonly reloadSession?: (sessionId: SessionId) => Promise<SessionDetail>
  readonly copySession?: (input: {
    readonly operation: 'fork' | 'clone'
    readonly sessionId: SessionId
    readonly targetNodeId: SessionNodeId
    readonly model: SupportedModelId
  }) => Promise<{
    readonly cancelled: boolean
    readonly session?: SessionDetail
    readonly editorText?: string
  }>
}

export interface OpenWaggleSessionTaskController {
  readonly start: (input: {
    readonly projectPath: string
    readonly objective: string
    readonly sessionId?: string
  }) => Promise<unknown>
  readonly listForSession: (sessionId: string) => Promise<readonly unknown[]>
  readonly hasActiveSessionTask: (sessionId: string) => boolean
  readonly getExecutionProfile: (
    sessionId: string,
  ) => Promise<{ readonly model: string; readonly thinkingLevel: string }>
  readonly cancelSession: (sessionId: string) => Promise<number>
  readonly waitForSession: (sessionId: string, timeoutMs: number) => Promise<boolean>
}

export function sessionSummary(session: SessionDetail) {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.projectPath,
    archived: session.archived === true,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    environmentMode: session.environmentMode ?? 'local',
    ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
  }
}

export async function derivedDepth(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
) {
  const depth = (await metadata.depth(options.originSessionId)) + 1
  if (depth > MCP_CONFIG.MAX_ORCHESTRATION_DEPTH) {
    throw new Error(
      `The operation would exceed the maximum hosted session depth of ${MCP_CONFIG.MAX_ORCHESTRATION_DEPTH}.`,
    )
  }
  return depth
}

export function assertNotOrigin(options: OpenWaggleMcpServeOptions, sessionId: string) {
  if (options.originSessionId === sessionId) {
    throw new Error('The caller profile cannot target its own origin session for this operation.')
  }
}

export function worktreePlan(input: SessionToolInput): SessionWorktreePlan {
  const environmentMode = input.environmentMode
  if (!environmentMode) throw new Error(`${input.operation} requires environmentMode.`)
  return {
    environmentMode,
    baseRef: input.baseRef?.trim() || null,
    startFromOrigin: input.startFromOrigin ?? false,
  }
}
