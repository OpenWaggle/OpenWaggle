import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ProjectTaskReference } from '@shared/types/action-definitions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverProjectTasks, resolveActionInvocation } from '../task-discovery'

let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-tasks-')))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
async function put(file: string, content: string) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), content)
}
function json(file: string, value: unknown) {
  return put(file, JSON.stringify(value))
}
function packageTask(task: string, directory = '.'): ProjectTaskReference {
  return {
    provider: 'package-script',
    source: directory === '.' ? 'package.json' : `${directory}/package.json`,
    directory,
    task,
  }
}

describe('project task discovery', () => {
  it('discovers declared workspace scripts without executing code, preserving duplicate names', async () => {
    await json('package.json', {
      name: 'root',
      packageManager: 'pnpm@11.15.1',
      workspaces: ['packages/*'],
      scripts: { test: 'touch MUST_NOT_RUN', preinstall: 'touch MUST_NOT_INSTALL' },
    })
    await json('packages/web/package.json', {
      name: '@app/web',
      scripts: { test: 'vitest', dev: 'vite' },
    })
    await json('unrelated/package.json', { scripts: { test: 'wrong-directory' } })
    await json('node_modules/dependency/package.json', { scripts: { test: 'wrong-dependency' } })
    const discovery = await discoverProjectTasks(root)
    expect(discovery.diagnostics).toEqual([])
    expect(
      discovery.tasks.map((task) => [task.group, task.reference.task, task.reference.directory]),
    ).toEqual([
      ['root', 'test', '.'],
      ['root', 'preinstall', '.'],
      ['@app/web', 'test', 'packages/web'],
      ['@app/web', 'dev', 'packages/web'],
    ])
    expect(discovery.tasks.every((task) => task.runner === 'pnpm')).toBe(true)
    await expect(readFile(join(root, 'MUST_NOT_RUN'))).rejects.toThrow()
    await expect(readFile(join(root, 'MUST_NOT_INSTALL'))).rejects.toThrow()
    expect(
      await resolveActionInvocation(root, {
        type: 'task',
        task: packageTask('test', 'packages/web'),
      }),
    ).toEqual({
      type: 'executable',
      executable: 'pnpm',
      args: ['run', 'test'],
      cwd: join(root, 'packages/web'),
    })
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
  })

  it('reports conflicting runners and gives packageManager precedence', async () => {
    await json('package.json', { scripts: { test: 'echo test' } })
    await put('pnpm-lock.yaml', '')
    await put('yarn.lock', '')
    const discovery = await discoverProjectTasks(root)
    expect(discovery.tasks[0]?.runner).toBeNull()
    await expect(
      resolveActionInvocation(root, { type: 'task', task: packageTask('test') }),
    ).rejects.toThrow('Conflicting lockfiles')
    await json('package.json', { packageManager: 'yarn@4.0.0', scripts: { test: 'echo test' } })
    expect((await discoverProjectTasks(root)).tasks[0]?.runner).toBe('yarn')
  })

  it('re-resolves task references after edits and refuses removed or moved scripts', async () => {
    await json('package.json', { scripts: { test: 'old-body' } })
    const invocation = { type: 'task' as const, task: packageTask('test') }
    await json('package.json', { scripts: { test: 'new-body' } })
    expect((await discoverProjectTasks(root)).tasks[0]?.description).toBe('new-body')
    expect(await resolveActionInvocation(root, invocation)).toMatchObject({
      executable: 'npm',
      args: ['run', 'test'],
    })
    await json('package.json', { scripts: { renamed: 'new-body' } })
    await expect(resolveActionInvocation(root, invocation)).rejects.toThrow('Task unavailable')
  })

  it('reports malformed sources instead of treating them as valid empty task lists', async () => {
    await put('package.json', '{broken')
    await put('pyproject.toml', '[broken')
    const discovery = await discoverProjectTasks(root)
    expect(discovery.tasks).toEqual([])
    expect(discovery.diagnostics.map((diagnostic) => diagnostic.source)).toEqual([
      'package.json',
      'pyproject.toml',
    ])
  })

  it('rejects parent traversal and symlink escapes', async () => {
    await json('package.json', { workspaces: ['../*'], scripts: { test: 'echo safe' } })
    expect((await discoverProjectTasks(root)).diagnostics[0]?.message).toContain(
      'inside the project',
    )
    await symlink(tmpdir(), join(root, 'outside'))
    await expect(
      resolveActionInvocation(root, { type: 'command', command: 'echo no', directory: 'outside' }),
    ).rejects.toThrow('escapes the workspace')
    await expect(
      resolveActionInvocation(root, { type: 'command', command: 'echo no', directory: '../' }),
    ).rejects.toThrow()
    await expect(
      resolveActionInvocation(root, {
        type: 'task',
        task: { ...packageTask('test'), source: '../package.json' },
      }),
    ).rejects.toThrow()
  })

  it('does not enumerate undeclared symlinked workspace packages', async () => {
    await json('package.json', { workspaces: ['packages/*'], scripts: {} })
    await json('outside/package.json', { scripts: { test: 'echo outside' } })
    await mkdir(join(root, 'packages'))
    await symlink(join(root, 'outside'), join(root, 'packages', 'linked'))
    expect((await discoverProjectTasks(root)).tasks).toEqual([])
  })

  it('reads Hatch scripts with inherited environments and explicit selectors', async () => {
    await put(
      'pyproject.toml',
      '[tool.hatch.envs.default.scripts]\ntest = "pytest"\n[tool.hatch.envs.web]\n[tool.hatch.envs.web.scripts]\ntest = ["pytest web", "coverage report"]\n[tool.hatch.envs.web.extra-scripts]\nlint = "ruff check"\n[tool.hatch.envs.lint]\ndetached = true\n[tool.hatch.envs.lint.scripts]\ncheck = "ruff check"\n',
    )
    const discovery = await discoverProjectTasks(root)
    expect(discovery.diagnostics).toEqual([])
    expect(
      discovery.tasks.map((task) => `${task.reference.environment}:${task.reference.task}`),
    ).toEqual(['default:test', 'web:lint', 'web:test', 'lint:check'])
    const task = discovery.tasks.find(
      (candidate) =>
        candidate.reference.environment === 'web' && candidate.reference.task === 'test',
    )
    expect(task?.description).toBe('pytest web\ncoverage report')
    if (!task) throw new Error('Missing fixture task')
    expect(
      await resolveActionInvocation(root, { type: 'task', task: task.reference }),
    ).toMatchObject({ executable: 'hatch', args: ['run', 'web:test'] })
  })

  it('uses hatch.toml over pyproject configuration and diagnoses unsupported matrices', async () => {
    await put('pyproject.toml', '[tool.hatch.envs.default.scripts]\nold = "echo old"')
    await put(
      'hatch.toml',
      '[envs.default.scripts]\ntest = "pytest"\n[[envs.matrixed.matrix]]\npython = ["3.12", "3.13"]',
    )
    const discovery = await discoverProjectTasks(root)
    expect(discovery.tasks.map((task) => task.reference.source)).toEqual(['hatch.toml'])
    expect(discovery.diagnostics[0]?.message).toContain('matrix environment')
  })

  it('discovers Cargo aliases without expanding them into stale copied commands', async () => {
    await put('.cargo/config.toml', '[alias]\nfast = ["test", "--release"]\nrecursive = "fast"\n')
    const discovery = await discoverProjectTasks(root)
    expect(discovery.diagnostics).toEqual([])
    const task = discovery.tasks[0]
    if (!task) throw new Error('Missing fixture task')
    expect(
      await resolveActionInvocation(root, { type: 'task', task: task.reference }),
    ).toMatchObject({ executable: 'cargo', args: ['fast'] })
    await put('.cargo/config', '[alias]\nfast = "other"')
    await expect(
      resolveActionInvocation(root, { type: 'task', task: task.reference }),
    ).rejects.toThrow('Cargo prefers')
  })
})
