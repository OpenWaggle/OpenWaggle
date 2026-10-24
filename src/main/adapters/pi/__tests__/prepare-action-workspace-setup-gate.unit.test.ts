import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'

const mocks = vi.hoisted(() => ({ birth: vi.fn() }))
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: mocks.birth,
}))
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { prepareActionWorkspace } from '../prepare-action-workspace'

describe('a worktree birth the run records', () => {
  let projectPath = ''
  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('gates on Setup when the run itself records a pending worktree birth', async () => {
    projectPath = await realpath(await mkdtemp(join(tmpdir(), 'action-recorded-birth-')))
    const workspacePath = join(projectPath, 'existing-worktree')
    await mkdir(workspacePath)
    // The Session's setup dispatch had nothing pending, so it never captured the folder.
    mocks.birth.mockResolvedValue(workspacePath)
    const order: string[] = []
    const result = await Effect.runPromise(
      prepareActionWorkspace(
        fromPartial<AgentKernelRunInput>({
          session: { id: SessionId('session'), projectPath, environmentMode: 'worktree' },
          signal: new AbortController().signal,
        }),
        {
          workspaces: {
            getBound: () =>
              Effect.succeed({
                id: 'workspace',
                projectPath,
                workingPath: workspacePath,
                pending: false,
                kind: 'managed-worktree',
                worktreeBranch: 'feature',
              }),
          },
          preparation: fromPartial<WorkspacePreparationServiceShape>({
            read: () =>
              Effect.succeed(
                fromPartial<WorkspacePreparation>({
                  revision: 1,
                  setup: { status: 'idle' },
                  snapshot: { profile: { id: 'default' }, definitions: [] },
                }),
              ),
            inspectWorkspaceGeneration: () =>
              Effect.succeed({ status: 'awaiting-birth' as const, workspacePath }),
            completeWorktreeBirth: () =>
              Effect.sync(() => {
                order.push('birth-recorded')
                return { status: 'current' as const }
              }),
            requireSetup: (workspace: ActionRunWorkspace) =>
              Effect.sync(() => {
                expect(workspace.workspacePath).toBe(workspacePath)
                order.push('setup-gate')
              }),
            environment: () =>
              Effect.sync(() => {
                order.push('environment')
                return { PREPARED: 'after-setup' }
              }),
          }),
        },
      ),
    )
    expect(order).toEqual(['birth-recorded', 'setup-gate', 'environment'])
    expect(result.preparedEnvironment).toEqual({ PREPARED: 'after-setup' })
  })
})
