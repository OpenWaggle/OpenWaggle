import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertProjectAllowed } from '../openwaggle-mcp-workspace-policy'

let temporaryRoot = ''

function options(workspaceRoots: readonly string[]) {
  return {
    workspaceRoots,
    sessionIds: new Set<string>(),
  }
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-policy-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('hosted MCP workspace policy', () => {
  it('rejects an existing symlink that escapes a granted workspace', async () => {
    const workspace = path.join(temporaryRoot, 'workspace')
    const outside = path.join(temporaryRoot, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const link = path.join(workspace, 'escape')
    await symlink(outside, link)

    expect(() => assertProjectAllowed(options([workspace]), link)).toThrow(
      'outside this server profile',
    )
  })

  it('rejects nonexistent final segments after checking their canonical parent', async () => {
    const workspace = path.join(temporaryRoot, 'workspace')
    const outside = path.join(temporaryRoot, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const link = path.join(workspace, 'escape')
    await symlink(outside, link)

    expect(() =>
      assertProjectAllowed(options([workspace]), path.join(link, 'new-project')),
    ).toThrow('outside this server profile')
    expect(() =>
      assertProjectAllowed(options([workspace]), path.join(workspace, 'new-project')),
    ).toThrow(
      `Project ${JSON.stringify(path.join(await realpath(workspace), 'new-project'))} does not exist`,
    )
  })

  it('rejects a dangling symlink used as the final project segment', async () => {
    const workspace = path.join(temporaryRoot, 'workspace')
    await mkdir(workspace)
    const link = path.join(workspace, 'dangling')
    await symlink(path.join(temporaryRoot, 'missing-outside'), link)

    expect(() => assertProjectAllowed(options([workspace]), link)).toThrow(
      'unresolved symbolic link',
    )
  })
})
