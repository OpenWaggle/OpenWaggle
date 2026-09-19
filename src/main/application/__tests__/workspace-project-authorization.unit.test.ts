import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { validateAuthorizedProjectPath } from '../../utils/project-path-validation'
import { authorizeWorkspaceProject } from '../workspace-project-authorization'

const { invokeHost } = vi.hoisted(() => ({ invokeHost: vi.fn() }))
vi.mock('../gui-session-command-router', () => ({ invokeConfiguredHostUi: invokeHost }))

describe('owner-routed workspace authorization', () => {
  let directory = ''
  let project = ''
  const authorizeLocally = vi.fn((requested: string) =>
    validateAuthorizedProjectPath(requested, []),
  )
  const run = (requested: string) =>
    Effect.runPromise(
      authorizeWorkspaceProject(requested).pipe(
        Effect.provideService(WorkspaceProjectAuthorization, { authorize: authorizeLocally }),
      ),
    )

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-owner-workspace-'))
    project = path.join(directory, 'project')
    await fs.mkdir(project)
    invokeHost.mockReset()
    authorizeLocally.mockReset()
    authorizeLocally.mockImplementation((requested) => validateAuthorizedProjectPath(requested, []))
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('authorizes the owner project even when the attached GUI has no local Session roots', async () => {
    const canonical = await fs.realpath(project)
    invokeHost.mockResolvedValue({ handled: true, result: canonical })
    await expect(run(project)).resolves.toBe(canonical)
    expect(invokeHost).toHaveBeenCalledWith('workspace-files:authorize-project', [project])
    expect(authorizeLocally).not.toHaveBeenCalled()
  })

  it('does not use stale local authorization when the owner rejects or is unavailable', async () => {
    authorizeLocally.mockReturnValue(Effect.succeed(project))
    invokeHost.mockRejectedValue(new Error('Owner rejected workspace access'))
    await expect(run(project)).rejects.toThrow('Owner rejected workspace access')
    expect(authorizeLocally).not.toHaveBeenCalled()
  })

  it('uses local authorization only in owner mode', async () => {
    invokeHost.mockResolvedValue({ handled: false })
    authorizeLocally.mockImplementation((requested) =>
      validateAuthorizedProjectPath(requested, [project]),
    )
    await expect(run(project)).resolves.toBe(await fs.realpath(project))
    expect(authorizeLocally).toHaveBeenCalledOnce()
  })

  it.each([null, {}, '../relative', '/different-root'])(
    'rejects malformed or mismatched owner result %j',
    async (result) => {
      invokeHost.mockResolvedValue({ handled: true, result })
      await expect(run(project)).rejects.toThrow()
      expect(authorizeLocally).not.toHaveBeenCalled()
    },
  )

  it('accepts a canonical owner result for a symlink alias without granting its parent', async () => {
    const alias = path.join(directory, 'alias')
    await fs.symlink(project, alias)
    invokeHost.mockResolvedValue({ handled: true, result: await fs.realpath(project) })
    await expect(run(alias)).resolves.toBe(await fs.realpath(project))
    await expect(run(directory)).rejects.toThrow()
  })
})
