import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import { Effect } from 'effect'
import { vi } from 'vitest'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import type {
  HostedSessionWorktreeInput,
  OpenWaggleSessionTaskController,
} from '../openwaggle-mcp-session-contract'

export const SESSION_ID = SessionId('session-target')

export function serveOptions(
  temporaryRoot: string,
  overrides: Partial<
    Pick<OpenWaggleMcpServeOptions, 'grants' | 'originSessionId' | 'sessionIds' | 'workspaceRoots'>
  > = {},
): OpenWaggleMcpServeOptions {
  return {
    transport: 'stdio',
    grants: new Set([
      'sessions:discover',
      'sessions:read',
      'sessions:create',
      'sessions:message',
      'sessions:interrupt',
      'sessions:organize',
    ]),
    workspaceRoots: [],
    sessionIds: new Set(),
    profile: 'test-profile',
    taskStorePath: path.join(temporaryRoot, 'tasks.json'),
    version: '0.0.0-test',
    ...overrides,
  }
}

export function session(
  temporaryRoot: string,
  overrides: Partial<SessionDetail> = {},
): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'Target session',
    projectPath: temporaryRoot,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

export function sessionTasks(): OpenWaggleSessionTaskController {
  return {
    start: vi.fn(() => Effect.succeed({ status: 'queued' })),
    listForSession: vi.fn(() => Effect.succeed([])),
    hasActiveSessionTask: vi.fn(() => false),
    getExecutionProfile: vi.fn(() =>
      Effect.succeed({
        model: 'provider/model',
        thinkingLevel: 'medium' satisfies ThinkingLevel,
      }),
    ),
    cancelSession: vi.fn(() => Effect.succeed(0)),
    waitForSession: vi.fn(() => Effect.succeed(true)),
  }
}

export function sessionAdapters(temporaryRoot: string) {
  return {
    materializeWorktree: vi.fn(async (input: HostedSessionWorktreeInput) => ({
      sourceProjectPath: input.sourceProjectPath,
      projectPath: path.join(temporaryRoot, 'worktree'),
      branch: 'ow/session-test',
      baseRef: input.baseRef ?? 'main',
      created: true,
    })),
    loadSession: vi.fn(async () => session(temporaryRoot)),
  }
}
