import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { WorkspaceProjectAuthorizationLive } from '../workspace-project-authorization'

const { findRoot, getSettings, listPage } = vi.hoisted(() => ({
  findRoot: vi.fn(),
  getSettings: vi.fn(),
  listPage: vi.fn(),
}))
vi.mock('../../store/settings', () => ({ getSettings }))
vi.mock('../../store/session-details/workspace-root-authorization', () => ({
  findSessionWorkspaceRoot: findRoot,
  listSessionWorkspaceRootPage: listPage,
}))

function authorize(projectPath: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* WorkspaceProjectAuthorization).authorize(projectPath)
    }).pipe(Effect.provide(WorkspaceProjectAuthorizationLive)),
  )
}

describe('owner workspace root authorization', () => {
  let directory = ''
  let project = ''
  let alias = ''

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-root-alias-'))
    project = path.join(directory, 'project')
    alias = path.join(directory, 'alias')
    await fs.mkdir(project)
    await fs.symlink(project, alias)
    getSettings.mockReset().mockReturnValue({
      ...DEFAULT_SETTINGS,
      projectPath: null,
      recentProjects: [],
      projectDisplayNames: {},
    })
    findRoot.mockReset().mockResolvedValue(null)
    listPage.mockReset().mockImplementation(async (after?: string) => (after ? [] : [alias]))
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('keeps registered canonical roots on the indexed fast path', async () => {
    const canonical = await fs.realpath(project)
    findRoot.mockResolvedValue(canonical)
    await expect(authorize(project)).resolves.toBe(canonical)
    expect(listPage).not.toHaveBeenCalled()
  })

  it('accepts canonical-first access to a migrated root stored as a symlink alias', async () => {
    const canonical = await fs.realpath(project)
    await expect(authorize(canonical)).resolves.toBe(canonical)
    expect(listPage).toHaveBeenCalledWith(undefined)
  })

  it('checks later pages without granting a parent or descendant of the stored root', async () => {
    const child = path.join(project, 'src')
    await fs.mkdir(child)
    listPage.mockImplementation(async (after?: string) => {
      if (after === undefined) return ['/missing-root']
      return after === '/missing-root' ? [alias] : []
    })
    await expect(authorize(project)).resolves.toBe(await fs.realpath(project))
    expect(listPage).toHaveBeenCalledWith('/missing-root')
    await expect(authorize(directory)).rejects.toThrow('not authorized')
    await expect(authorize(child)).rejects.toThrow('not authorized')
  })

  it('does not retain authorization after a legacy alias is retargeted or revoked', async () => {
    const canonical = await fs.realpath(project)
    await expect(authorize(canonical)).resolves.toBe(canonical)
    const other = path.join(directory, 'other')
    await fs.mkdir(other)
    await fs.unlink(alias)
    await fs.symlink(other, alias)
    await expect(authorize(canonical)).rejects.toThrow('not authorized')
    await expect(authorize(other)).resolves.toBe(await fs.realpath(other))
    listPage.mockResolvedValue([])
    await expect(authorize(other)).rejects.toThrow('not authorized')
  })

  it('fails closed when the legacy root page cannot be read', async () => {
    listPage.mockRejectedValue(new Error('database unavailable'))
    await expect(authorize(project)).rejects.toThrow('Unable to verify authorized workspace')
  })
})
