import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { discoverProjectTasks, resolveActionInvocation } from '../task-discovery'

let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-package-tasks-')))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function json(file: string, value: unknown) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), JSON.stringify(value))
}

async function put(file: string, content: string) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), content)
}

function invocation(directory: string) {
  return {
    type: 'task' as const,
    task: {
      provider: 'package-script' as const,
      source: `${directory}/package.json`,
      directory,
      task: 'test',
    },
  }
}

it('resolves a declared package task beyond the workspace package discovery cap', async () => {
  await json('package.json', {
    packageManager: 'pnpm@11.15.1',
    workspaces: ['packages/*', '!packages/excluded'],
  })
  const directories = Array.from(
    { length: ACTION_DEFINITION_LIMITS.WORKSPACE_PACKAGES + 1 },
    (_, index) => `packages/package${index}`,
  )
  await Promise.all(
    directories.map((directory) =>
      json(`${directory}/package.json`, { scripts: { test: 'echo ready' } }),
    ),
  )
  await json('packages/excluded/package.json', { scripts: { test: 'echo excluded' } })
  await json('unrelated/package.json', { scripts: { test: 'echo unrelated' } })
  expect((await discoverProjectTasks(root)).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: 'Too many workspace packages to discover safely.' }),
    ]),
  )
  const lastPackage = directories.at(-1)
  if (!lastPackage) throw new Error('Missing package fixture')
  await expect(resolveActionInvocation(root, invocation(lastPackage))).resolves.toMatchObject({
    executable: 'pnpm',
    cwd: join(root, lastPackage),
  })
  for (const directory of ['packages/excluded', 'unrelated']) {
    await expect(resolveActionInvocation(root, invocation(directory))).rejects.toThrow(
      'Task unavailable',
    )
  }
  await rm(join(root, lastPackage, 'package.json'))
  await expect(resolveActionInvocation(root, invocation(lastPackage))).rejects.toThrow(
    'Task unavailable',
  )
})

it('honors pnpm workspace exclusions and ignores generated/dependency packages', async () => {
  await json('package.json', { scripts: {} })
  await put('pnpm-workspace.yaml', "packages:\n  - '**'\n  - '!packages/excluded'\n")
  for (const directory of [
    'packages/web',
    'packages/excluded',
    'dist/generated',
    'node_modules/dependency',
    '.venv/site',
  ]) {
    await json(`${directory}/package.json`, { scripts: { test: 'echo test' } })
  }
  const discovery = await discoverProjectTasks(root)
  expect(discovery.tasks.map((task) => task.reference.directory)).toEqual(['packages/web'])
  await expect(resolveActionInvocation(root, invocation('packages/web'))).resolves.toMatchObject({
    cwd: join(root, 'packages/web'),
  })
  await expect(resolveActionInvocation(root, invocation('packages/excluded'))).rejects.toThrow(
    'Task unavailable',
  )
})

it('does not resolve symlinked workspace packages', async () => {
  await json('package.json', { workspaces: ['packages/*'], scripts: {} })
  await json('outside/package.json', { scripts: { test: 'echo outside' } })
  await mkdir(join(root, 'packages'))
  await symlink(join(root, 'outside'), join(root, 'packages', 'linked'))
  expect((await discoverProjectTasks(root)).tasks).toEqual([])
  await expect(resolveActionInvocation(root, invocation('packages/linked'))).rejects.toThrow(
    'Task unavailable',
  )
})
