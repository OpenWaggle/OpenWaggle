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

  it.each([
    ['recorded by this run', true, ['birth-recorded', 'owed?', 'setup-gate', 'environment']],
    // Another run, such as a Project Action run, recorded it earlier; the check is current now.
    ['recorded by an earlier run', true, ['owed?', 'setup-gate', 'environment']],
    ['recorded by setup dispatch', false, ['owed?', 'environment']],
  ] as const)('gates on owed Setup for a worktree birth %s', async (recordedBy, owed, expected) => {
    projectPath = await realpath(await mkdtemp(join(tmpdir(), 'action-recorded-birth-')))
    const workspacePath = join(projectPath, 'existing-worktree')
    await mkdir(workspacePath)
    // This Session's setup dispatch has nothing pending, so it does not run setup.
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
              Effect.succeed(
                recordedBy === 'recorded by this run'
                  ? { status: 'awaiting-birth' as const, workspacePath }
                  : { status: 'current' as const },
              ),
            completeWorktreeBirth: () =>
              Effect.sync(() => {
                order.push('birth-recorded')
                return { status: 'current' as const }
              }),
            owesSetupAfterRunBirth: () =>
              Effect.sync(() => {
                order.push('owed?')
                return owed
              }),
            requireSetup: (workspace: ActionRunWorkspace) =>
              Effect.sync(() => {
                expect(workspace.workspacePath).toBe(workspacePath)
                order.push('setup-gate')
              }),
            environment: () =>
              Effect.sync(() => {
                order.push('environment')
                return { PREPARED: 'yes' }
              }),
          }),
        },
      ),
    )
    expect(order).toEqual(expected)
    expect(result.preparedEnvironment).toEqual({ PREPARED: 'yes' })
  })
})
