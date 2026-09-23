import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import type { SessionWorktreeSetupDispatchOptions } from '../agent-kernel/session-worktree-setup-dispatch'

const mocks = vi.hoisted(() => ({ birth: vi.fn() }))
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: mocks.birth,
}))

import { prepareActionWorkspace } from '../prepare-action-workspace'

describe('preparation around worktree birth', () => {
  let projectPath = ''
  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('captures before a future path exists and gates execution on setup in the created checkout', async () => {
    projectPath = await realpath(await mkdtemp(join(tmpdir(), 'action-birth-')))
    const workspacePath = join(projectPath, 'future-worktree')
    const order: string[] = []
    let pending = true
    mocks.birth.mockImplementation(
      async (_session, options: SessionWorktreeSetupDispatchOptions) => {
        await options.onBeforeWorktreeCreate?.()
        await mkdir(workspacePath)
        pending = false
        order.push('created')
        await options.onSetupPending?.({
          session: fromPartial({ id: SessionId('session'), projectPath }),
          primaryPath: projectPath,
          worktreePath: workspacePath,
          setupGeneration: 'birth',
          resumingClaim: false,
        })
        return workspacePath
      },
    )
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
                pending,
                kind: 'managed-worktree',
                worktreeBranch: 'feature',
              }),
          },
          preparation: fromPartial<WorkspacePreparationServiceShape>({
            prepareBirth: (workspace: ActionRunWorkspace) =>
              Effect.promise(async () => {
                expect(await realpath(workspace.workspacePath)).toBe(projectPath)
                order.push('captured-before-birth')
                return fromPartial({})
              }),
            capture: (workspace: ActionRunWorkspace) =>
              Effect.promise(async () => {
                // The real catalog also canonicalizes its input before reading definitions.
                const canonical = await realpath(workspace.workspacePath)
                expect(canonical).toBe(pending ? projectPath : workspacePath)
                order.push(pending ? 'captured-before-birth' : 'captured-existing')
                return fromPartial({})
              }),
            read: () => Effect.succeed(null),
            requireSetup: (workspace: ActionRunWorkspace) =>
              Effect.sync(() => {
                expect(workspace.workspacePath).toBe(workspacePath)
                expect(pending).toBe(false)
                order.push('setup-gate')
                return fromPartial({})
              }),
            environment: () =>
              Effect.sync(() => {
                expect(order).toContain('setup-gate')
                return { PREPARED: 'yes' }
              }),
          }),
        },
      ),
    )
    expect(order).toEqual(['captured-before-birth', 'created', 'captured-existing', 'setup-gate'])
    expect(result).toEqual({
      projectPath,
      executionPath: workspacePath,
      preparedEnvironment: { PREPARED: 'yes' },
    })
  })

  it('does not start idle Setup after a worktree already exists', async () => {
    projectPath = await realpath(await mkdtemp(join(tmpdir(), 'action-existing-')))
    const workspacePath = join(projectPath, 'existing-worktree')
    await mkdir(workspacePath)
    mocks.birth.mockResolvedValue(workspacePath)
    const requireSetup = vi.fn(() => Effect.succeed(fromPartial({})))

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
            requireSetup,
            environment: () => Effect.succeed({ PREPARED: 'retained' }),
          }),
        },
      ),
    )

    expect(requireSetup).not.toHaveBeenCalled()
    expect(result).toEqual({
      projectPath,
      executionPath: workspacePath,
      preparedEnvironment: { PREPARED: 'retained' },
    })
  })
})
