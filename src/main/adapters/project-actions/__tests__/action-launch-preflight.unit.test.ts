import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActionDefinition } from '@shared/types/action-definitions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveManagedActionLaunch } from '../action-launch-preflight'

let root: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'action-launch-preflight-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function launch(directory: string) {
  const definition: ActionDefinition = {
    id: 'test',
    name: 'Test',
    icon: 'test',
    invocation: { type: 'command', command: 'test', directory },
    kind: 'task',
    allowConcurrent: false,
    autoOpenPreview: false,
  }
  const workspace = { workspaceId: 'workspace-one', projectPath: root, workspacePath: root }
  const deps = {
    catalog: vi.fn(async () => ({
      revision: 'one',
      actions: [{ source: 'local' as const, definition }],
      profiles: [],
      preparation: [],
    })),
    // Reading it can complete a pending worktree's setup.
    environment: vi.fn(async () => ({})),
    runner: { validate: vi.fn(async () => undefined), start: vi.fn() },
  }
  return {
    deps,
    run: () =>
      resolveManagedActionLaunch({ workspace, actionId: 'test', requestId: 'request-one' }, deps),
  }
}

describe('resolveManagedActionLaunch', () => {
  it('reads the environment only once the invocation resolved', async () => {
    const { deps, run } = launch('missing')

    await expect(run()).rejects.toThrow()

    expect(deps.environment).not.toHaveBeenCalled()
    expect(deps.runner.validate).not.toHaveBeenCalled()
  })

  it('validates the resolved invocation with the workspace environment', async () => {
    const { deps, run } = launch('.')

    await expect(run()).resolves.toMatchObject({
      invocation: { type: 'command', command: 'test', cwd: root },
      environment: {},
    })

    expect(deps.environment).toHaveBeenCalledOnce()
    expect(deps.runner.validate).toHaveBeenCalledOnce()
  })
})
